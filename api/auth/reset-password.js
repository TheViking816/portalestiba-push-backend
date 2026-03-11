// ============================================
// PASSWORD RECOVERY - RESET PASSWORD API
// ============================================
// Endpoint: POST /api/auth/reset-password
// Valida token y actualiza contraseña del usuario

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONFIGURACIÓN
// ============================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// CONSTANTES
// ============================================
const MIN_PASSWORD_LENGTH = 6;
const PASSWORD_HASH_ITERATIONS = 100000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    PASSWORD_HASH_ITERATIONS,
    32,
    'sha256'
  );

  return `${salt.toString('base64')}$${PASSWORD_HASH_ITERATIONS}$${hash.toString('base64')}`;
}

// ============================================
// FUNCIÓN PRINCIPAL
// ============================================
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Solo permitir POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Método no permitido'
    });
  }

  try {
    // ============================================
    // 1. VALIDAR INPUT
    // ============================================
    const { token, newPassword } = req.body;

    // Validar token
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Token es requerido'
      });
    }

    // Validar nueva contraseña
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Contraseña es requerida'
      });
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`
      });
    }

    const tokenLimpio = token.trim();

    console.log(`[RESET-PASSWORD] Intentando resetear contraseña con token: ${tokenLimpio.substring(0, 10)}...`);

    // ============================================
    // 2. VALIDAR TOKEN DIRECTAMENTE EN LA TABLA
    // ============================================
    const { data: tokenRecord, error: tokenError } = await supabase
      .from('password_reset_tokens')
      .select('id, chapa, expires_at, used_at')
      .eq('token', tokenLimpio)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenError) {
      console.error('[RESET-PASSWORD] Error consultando token:', tokenError);
      return res.status(500).json({
        success: false,
        message: 'Error al procesar la solicitud. Inténtalo de nuevo.'
      });
    }

    if (!tokenRecord) {
      return res.status(400).json({
        success: false,
        error: 'invalid_token',
        message: 'El enlace de recuperación no es válido.'
      });
    }

    if (tokenRecord.used_at) {
      return res.status(400).json({
        success: false,
        error: 'token_used',
        message: 'Este enlace de recuperación ya fue utilizado.'
      });
    }

    if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        error: 'token_expired',
        message: 'Este enlace de recuperación ha expirado. Solicita uno nuevo.'
      });
    }

    // ============================================
    // 3. VERIFICAR USUARIO Y ACTUALIZAR CONTRASEÑA
    // ============================================
    const { data: usuario, error: usuarioError } = await supabase
      .from('usuarios')
      .select('chapa, activo')
      .eq('chapa', tokenRecord.chapa)
      .maybeSingle();

    if (usuarioError) {
      console.error('[RESET-PASSWORD] Error consultando usuario:', usuarioError);
      return res.status(500).json({
        success: false,
        message: 'Error al procesar la solicitud. Inténtalo de nuevo.'
      });
    }

    if (!usuario || !usuario.activo) {
      return res.status(400).json({
        success: false,
        error: 'user_not_available',
        message: 'La cuenta asociada al enlace no está disponible.'
      });
    }

    const passwordHash = hashPassword(newPassword);

    const { error: updateUserError } = await supabase
      .from('usuarios')
      .update({
        password_hash: passwordHash,
        updated_at: new Date().toISOString()
      })
      .eq('chapa', tokenRecord.chapa);

    if (updateUserError) {
      console.error('[RESET-PASSWORD] Error actualizando contraseña:', updateUserError);
      return res.status(500).json({
        success: false,
        message: 'No se pudo actualizar la contraseña. Inténtalo de nuevo.'
      });
    }

    const nowIso = new Date().toISOString();

    const { error: markUsedError } = await supabase
      .from('password_reset_tokens')
      .update({ used_at: nowIso })
      .eq('id', tokenRecord.id);

    if (markUsedError) {
      console.error('[RESET-PASSWORD] Error marcando token como usado:', markUsedError);
      return res.status(500).json({
        success: false,
        message: 'La contraseña se actualizó, pero no se pudo cerrar el enlace de recuperación. Revisa el estado manualmente.'
      });
    }

    await supabase
      .from('password_reset_tokens')
      .update({ used_at: nowIso })
      .eq('chapa', tokenRecord.chapa)
      .is('used_at', null)
      .neq('id', tokenRecord.id);

    // ============================================
    // 4. RETORNAR ÉXITO
    // ============================================
    console.log(`[RESET-PASSWORD] Contraseña actualizada exitosamente para chapa: ${tokenRecord.chapa}`);

    return res.status(200).json({
      success: true,
      message: 'Contraseña actualizada correctamente'
    });

  } catch (error) {
    console.error('[RESET-PASSWORD] Error inesperado:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud. Inténtalo de nuevo.'
    });
  }
};
