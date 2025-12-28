// ============================================
// EMAIL VERIFICATION - REQUEST CODE
// ============================================
// Endpoint: POST /api/auth/request-email-verify
// Genera un codigo y lo envia al correo indicado
const crypto = require('crypto');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONFIGURACION
// ============================================
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Portal Estiba VLC <onboarding@resend.dev>';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// CONSTANTES
// ============================================
const CODE_EXPIRATION_MINUTES = 15;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generarCodigo() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function crearEmailHtml(chapa, codigo) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codigo de verificacion</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 32px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 26px;">Verificacion de correo</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                Hemos recibido una solicitud para registrar este correo en tu cuenta (Chapa: <strong>${chapa}</strong>).
              </p>
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Introduce el siguiente codigo en la aplicacion. Este codigo expira en ${CODE_EXPIRATION_MINUTES} minutos.
              </p>
              <div style="background-color: #eff6ff; color: #1e3a8a; font-size: 28px; font-weight: bold; text-align: center; padding: 16px; border-radius: 8px; letter-spacing: 4px;">
                ${codigo}
              </div>
              <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                Si no solicitaste este codigo, puedes ignorar este correo.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-radius: 0 0 8px 8px;">
              <p style="color: #666666; font-size: 13px; margin: 0;">Portal Estiba VLC</p>
              <p style="color: #999999; font-size: 12px; margin: 6px 0 0 0;">Correo automatico. No respondas.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function crearEmailText(chapa, codigo) {
  return [
    `Codigo de verificacion para la chapa ${chapa}: ${codigo}`,
    '',
    `Este codigo expira en ${CODE_EXPIRATION_MINUTES} minutos.`,
    'Si no solicitaste este codigo, puedes ignorar este correo.'
  ].join('\n');
}

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
    const { chapa, email } = req.body || {};
    if (!chapa || !email) {
      return res.status(400).json({
        success: false,
        message: 'Chapa y correo son obligatorios'
      });
    }

    const chapaLimpia = chapa.toString().trim();
    const emailLimpio = email.toString().trim().toLowerCase();

    if (!isValidEmail(emailLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El correo no tiene un formato valido'
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
      return res.status(200).json({
        success: false,
        hasEmail: true,
        message: 'Tu cuenta ya tiene un correo registrado. Usa la recuperacion.'
      });
    }

    const codigo = generarCodigo();
    const expiresAt = new Date(Date.now() + CODE_EXPIRATION_MINUTES * 60 * 1000);

    await supabase
      .from('email_verification_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('chapa', chapaLimpia)
      .is('used_at', null);

    const { error: insertError } = await supabase
      .from('email_verification_codes')
      .insert({
        chapa: chapaLimpia,
        email: emailLimpio,
        code: codigo,
        expires_at: expiresAt.toISOString()
      });

    if (insertError) {
      console.error('[EMAIL-VERIFY] Error guardando codigo:', insertError);
      return res.status(500).json({
        success: false,
        message: 'Error al generar el codigo. Intentalo de nuevo.'
      });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Falta configurar RESEND_API_KEY'
      });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const emailHtml = crearEmailHtml(chapaLimpia, codigo);
    const emailText = crearEmailText(chapaLimpia, codigo);

    const { error: emailError } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: emailLimpio,
      subject: 'Codigo de verificacion - Portal Estiba VLC',
      html: emailHtml,
      text: emailText
    });

    if (emailError) {
      console.error('[EMAIL-VERIFY] Error enviando email:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Error al enviar el codigo. Intentalo de nuevo.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Codigo enviado. Revisa tu correo.'
    });
  } catch (error) {
    console.error('[EMAIL-VERIFY] Error inesperado:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud. Intentalo de nuevo.'
    });
  }
};
