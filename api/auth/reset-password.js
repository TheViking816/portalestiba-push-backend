// ============================================
// PASSWORD RECOVERY - RESET PASSWORD API
// ============================================
// Endpoint: POST /api/auth/reset-password
// Valida token y actualiza contraseña del usuario

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
    // 2. LLAMAR A RPC FUNCTION DE SUPABASE
    // ============================================
    // La función RPC valida:
    // - Token existe
    // - Token no ha sido usado
    // - Token no ha expirado
    // - Usuario existe
    // Y actualiza la contraseña si todo es válido

    const { data, error } = await supabase.rpc('reset_user_password', {
      p_token: tokenLimpio,
      p_new_password: newPassword
    });

    if (error) {
      console.error('[RESET-PASSWORD] Error en RPC function:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al procesar la solicitud. Inténtalo de nuevo.'
      });
    }

    // ============================================
    // 3. PROCESAR RESPUESTA DE RPC
    // ============================================
    if (!data || !data.success) {
      // La RPC retornó un error específico
      const errorMessage = data?.message || 'Error al resetear contraseña';
      const errorCode = data?.error || 'unknown_error';

      console.log(`[RESET-PASSWORD] Error de validación: ${errorCode} - ${errorMessage}`);

      return res.status(400).json({
        success: false,
        error: errorCode,
        message: errorMessage
      });
    }

    // ============================================
    // 4. RETORNAR ÉXITO
    // ============================================
    console.log(`[RESET-PASSWORD] Contraseña actualizada exitosamente para chapa: ${data.chapa}`);

    return res.status(200).json({
      success: true,
      message: data.message || 'Contraseña actualizada correctamente'
    });

  } catch (error) {
    console.error('[RESET-PASSWORD] Error inesperado:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud. Inténtalo de nuevo.'
    });
  }
};
