// ============================================
// EMAIL VERIFICATION - CONFIRM CODE
// ============================================
// Endpoint: POST /api/auth/confirm-email-verify
// Valida el codigo y guarda el correo en usuarios
const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONFIGURACION
// ============================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// FUNCION PRINCIPAL
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
      message: 'Metodo no permitido'
    });
  }

  try {
    const { chapa, code, email } = req.body || {};
    if (!chapa || !code) {
      return res.status(400).json({
        success: false,
        message: 'Chapa y codigo son obligatorios'
      });
    }

    const chapaLimpia = chapa.toString().trim();
    const codeLimpio = code.toString().trim();
    const emailLimpio = email ? email.toString().trim().toLowerCase() : null;

    if (!/^\d{6}$/.test(codeLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'Codigo invalido'
      });
    }

    const { data: usuario, error: usuarioError } = await supabase
      .from('usuarios')
      .select('chapa, email, activo')
      .eq('chapa', chapaLimpia)
      .single();

    if (usuarioError || !usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    if (!usuario.activo) {
      return res.status(403).json({
        success: false,
        message: 'Usuario inactivo'
      });
    }

    if (usuario.email && usuario.email.trim() !== '') {
      return res.status(400).json({
        success: false,
        message: 'La cuenta ya tiene un correo registrado'
      });
    }

    const { data: codeRecord, error: codeError } = await supabase
      .from('email_verification_codes')
      .select('id, email, expires_at, used_at')
      .eq('chapa', chapaLimpia)
      .eq('code', codeLimpio)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (codeError || !codeRecord) {
      return res.status(400).json({
        success: false,
        message: 'Codigo no valido o expirado'
      });
    }

    if (codeRecord.used_at) {
      return res.status(400).json({
        success: false,
        message: 'Este codigo ya fue utilizado'
      });
    }

    if (new Date(codeRecord.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Este codigo ha expirado. Solicita uno nuevo.'
      });
    }

    if (emailLimpio && codeRecord.email.toLowerCase() !== emailLimpio) {
      return res.status(400).json({
        success: false,
        message: 'El correo no coincide con el codigo'
      });
    }

    const { error: updateError } = await supabase
      .from('usuarios')
      .update({
        email: codeRecord.email,
        updated_at: new Date().toISOString()
      })
      .eq('chapa', chapaLimpia);

    if (updateError) {
      console.error('[EMAIL-VERIFY] Error actualizando usuario:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Error al guardar el correo. Intentalo de nuevo.'
      });
    }

    await supabase
      .from('email_verification_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', codeRecord.id);

    return res.status(200).json({
      success: true,
      message: 'Correo verificado correctamente'
    });
  } catch (error) {
    console.error('[EMAIL-VERIFY] Error inesperado:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud. Intentalo de nuevo.'
    });
  }
};
