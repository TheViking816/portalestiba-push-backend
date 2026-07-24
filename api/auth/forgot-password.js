// ============================================
// PASSWORD RECOVERY - FORGOT PASSWORD API
// ============================================
// Endpoint: POST /api/auth/forgot-password
// Genera token de recuperación y envía email mediante Gmail SMTP

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONFIGURACIÓN
// ============================================
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const mailTransport = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD
      }
    })
  : null;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// CONSTANTES
// ============================================
const TOKEN_EXPIRATION_HOURS = 1;
const RESET_PAGE_URL = 'https://portal-estiba-vlc.vercel.app/reset-password.html';

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
    const { chapa } = req.body;

    if (!chapa || typeof chapa !== 'string' || chapa.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Chapa es requerida'
      });
    }

    const chapaLimpia = chapa.trim();

    // ============================================
    // 2. BUSCAR USUARIO EN SUPABASE
    // ============================================
    const { data: usuario, error: errorUsuario } = await supabase
      .from('usuarios')
      .select('chapa, nombre, email, activo')
      .eq('chapa', chapaLimpia)
      .single();

    // SEGURIDAD: Retornar mensaje genérico para prevenir enumeración de usuarios
    if (errorUsuario || !usuario) {
      console.log(`[FORGOT-PASSWORD] Usuario no encontrado: ${chapaLimpia}`);
      return res.status(200).json({
        success: true,
        message: 'Si el usuario existe y tiene un correo registrado, recibirás un enlace de recuperación.'
      });
    }

    // Validar que el usuario esté activo
    if (!usuario.activo) {
      console.log(`[FORGOT-PASSWORD] Usuario inactivo: ${chapaLimpia}`);
      return res.status(200).json({
        success: true,
        message: 'Si el usuario existe y tiene un correo registrado, recibirás un enlace de recuperación.'
      });
    }

    // Validar que el usuario tenga email
    if (!usuario.email || usuario.email.trim() === '') {
      console.log(`[FORGOT-PASSWORD] Usuario sin email: ${chapaLimpia}`);
      return res.status(200).json({
        success: false,
        needsEmail: true,
        message: 'Tu cuenta no tiene un correo registrado. Verifica tu email para continuar.'
      });
    }

    // ============================================
    // 3. GENERAR TOKEN CRIPTOGRÁFICAMENTE SEGURO
    // ============================================
    const token = crypto.randomBytes(32).toString('hex'); // 64 caracteres
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);

    console.log(`[FORGOT-PASSWORD] Token generado para ${chapaLimpia}, expira: ${expiresAt.toISOString()}`);

    // ============================================
    // 4. GUARDAR TOKEN EN SUPABASE
    // ============================================
    const { error: errorToken } = await supabase
      .from('password_reset_tokens')
      .insert({
        chapa: usuario.chapa,
        email: usuario.email,
        token: token,
        expires_at: expiresAt.toISOString()
      });

    if (errorToken) {
      console.error('[FORGOT-PASSWORD] Error guardando token:', errorToken);
      return res.status(500).json({
        success: false,
        message: 'Error al procesar solicitud. Inténtalo de nuevo.'
      });
    }

    // ============================================
    // 5. CREAR ENLACE DE RECUPERACIÓN
    // ============================================
    const resetLink = `${RESET_PAGE_URL}?token=${token}`;

    // ============================================
    // 6. ENVIAR EMAIL MEDIANTE GMAIL
    // ============================================
    if (!mailTransport) {
      return res.status(500).json({
        success: false,
        message: 'El servicio de correo no está configurado.'
      });
    }

    const emailHtml = crearEmailHTML(usuario.nombre, usuario.chapa, resetLink);
    const emailText = crearEmailText(usuario.nombre, usuario.chapa, resetLink);

    let emailData;
    try {
      emailData = await mailTransport.sendMail({
        from: `Portal Estiba VLC <${GMAIL_USER}>`,
        to: usuario.email,
        subject: 'Recupera tu contrasena - Portal Estiba VLC',
        html: emailHtml,
        text: emailText
      });

      if (!Array.isArray(emailData.accepted) || emailData.accepted.length === 0) {
        throw new Error('Gmail no aceptó ningún destinatario');
      }
    } catch (emailError) {
      await supabase
        .from('password_reset_tokens')
        .delete()
        .eq('token', token);
      console.error('[FORGOT-PASSWORD] Error enviando email:', emailError.message);
      return res.status(500).json({
        success: false,
        message: 'Error al enviar correo de recuperación. Inténtalo de nuevo.'
      });
    }

    console.log(`[FORGOT-PASSWORD] Email aceptado por Gmail para ${usuario.chapa}, ID: ${emailData.messageId}`);

    // ============================================
    // 7. RETORNAR ÉXITO
    // ============================================
    return res.status(200).json({
      success: true,
      message: 'Correo de recuperación enviado. Revisa tu bandeja de entrada.'
    });

  } catch (error) {
    console.error('[FORGOT-PASSWORD] Error inesperado:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar solicitud. Inténtalo de nuevo.'
    });
  }
};

// ============================================
// FUNCIÓN: CREAR EMAIL HTML
// ============================================
function crearEmailHTML(nombre, chapa, resetLink) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recupera tu contrase&ntilde;a</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 40px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Recuperacion de Contrasena</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${nombre}</strong> (Chapa: <strong>${chapa}</strong>),
              </p>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Recibimos una solicitud para restablecer la contrase&ntilde;a de tu cuenta en el <strong>Portal Estiba VLC</strong>.
              </p>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                Haz clic en el bot&oacute;n de abajo para crear una nueva contrase&ntilde;a. Este enlace <strong>expirar&aacute; en 1 hora</strong>.
              </p>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${resetLink}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 6px; font-size: 18px; font-weight: bold;">
                      Restablecer Contrase&ntilde;a
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback Link -->
              <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0; padding: 20px; background-color: #f9fafb; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <strong>Si el bot&oacute;n no funciona</strong>, copia y pega este enlace en tu navegador:<br>
                <a href="${resetLink}" style="color: #3b82f6; word-break: break-all;">${resetLink}</a>
              </p>

              <!-- Security Notice -->
              <p style="color: #dc2626; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0; padding: 15px; background-color: #fef2f2; border-left: 4px solid #dc2626; border-radius: 4px;">
                <strong>Aviso de seguridad:</strong><br>
                Si no solicitaste este cambio de contrase&ntilde;a, ignora este correo. Tu contrase&ntilde;a permanecer&aacute; segura.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 8px 8px;">
              <p style="color: #666666; font-size: 14px; margin: 0 0 10px 0;">
                Portal Estiba VLC
              </p>
              <p style="color: #999999; font-size: 12px; margin: 0;">
                Este es un correo autom&aacute;tico. Por favor, no respondas a este mensaje.
              </p>
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

function crearEmailText(nombre, chapa, resetLink) {
  return [
    `Hola ${nombre} (Chapa: ${chapa}),`,
    '',
    'Recibimos una solicitud para restablecer la contrasena de tu cuenta en el Portal Estiba VLC.',
    'Si no la solicitaste, puedes ignorar este correo.',
    '',
    `Enlace de recuperacion (expira en 1 hora): ${resetLink}`,
    ''
  ].join('\n');
}

