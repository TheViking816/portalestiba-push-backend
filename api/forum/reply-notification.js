const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const APP_URL = 'https://portal-estiba-vlc.vercel.app';

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
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function excerpt(value, maxLength = 220) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

function buildEmailHtml({ recipientName, authorName, replyText, originalText, forumUrl }) {
  return `
    <!doctype html>
    <html lang="es">
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px;background:#f1f5f9;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="padding:24px;background:#0a2e5c;color:#fff;">
                    <h1 style="margin:0;font-size:22px;">Han respondido a tu mensaje</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 18px;">Hola ${escapeHtml(recipientName)}, ${escapeHtml(authorName)} ha respondido a tu mensaje en el foro.</p>
                    <div style="padding:12px 14px;border-left:4px solid #94a3b8;background:#f8fafc;color:#475569;">
                      ${escapeHtml(excerpt(originalText))}
                    </div>
                    <div style="margin-top:12px;padding:12px 14px;border-left:4px solid #14b8a6;background:#ecfeff;">
                      ${escapeHtml(excerpt(replyText))}
                    </div>
                    <p style="margin:24px 0 0;">
                      <a href="${escapeHtml(forumUrl)}" style="display:inline-block;padding:11px 18px;border-radius:9px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;">Ver respuesta</a>
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

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Metodo no permitido' });
  }

  const messageId = Number(req.body?.messageId);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return res.status(400).json({ success: false, message: 'Mensaje no valido' });
  }

  try {
    const { data: reply, error: replyError } = await supabase
      .from('mensajes_foro')
      .select('id, chapa, texto, parent_message_id, reply_to_chapa')
      .eq('id', messageId)
      .maybeSingle();

    if (replyError) throw replyError;
    if (!reply?.parent_message_id || !reply.reply_to_chapa) {
      return res.status(200).json({ success: true, sent: false, reason: 'not_a_reply' });
    }

    if (String(reply.chapa) === String(reply.reply_to_chapa)) {
      return res.status(200).json({ success: true, sent: false, reason: 'self_reply' });
    }

    const [{ data: original, error: originalError }, { data: recipient, error: recipientError }, { data: author }] =
      await Promise.all([
        supabase
          .from('mensajes_foro')
          .select('id, texto')
          .eq('id', reply.parent_message_id)
          .maybeSingle(),
        supabase
          .from('usuarios')
          .select('chapa, nombre, email, activo')
          .eq('chapa', reply.reply_to_chapa)
          .maybeSingle(),
        supabase
          .from('usuarios')
          .select('chapa, nombre')
          .eq('chapa', reply.chapa)
          .maybeSingle()
      ]);

    if (originalError) throw originalError;
    if (recipientError) throw recipientError;
    if (!recipient?.activo || !recipient.email) {
      return res.status(200).json({ success: true, sent: false, reason: 'recipient_without_email' });
    }
    if (!mailTransport) {
      return res.status(503).json({ success: false, message: 'Servicio de correo no configurado' });
    }

    const { error: claimError } = await supabase
      .from('foro_email_deliveries')
      .insert({ message_id: messageId });

    if (claimError?.code === '23505') {
      return res.status(200).json({ success: true, sent: false, reason: 'already_sent' });
    }
    if (claimError) throw claimError;

    const recipientName = recipient.nombre || `Chapa ${recipient.chapa}`;
    const authorName = author?.nombre || `Chapa ${reply.chapa}`;
    const forumUrl = `${APP_URL}/?page=foro&message=${messageId}`;

    try {
      const emailData = await mailTransport.sendMail({
        from: `Portal Estiba VLC <${GMAIL_USER}>`,
        to: recipient.email,
        subject: 'Han respondido a tu mensaje en el foro',
        text: [
          `Hola ${recipientName},`,
          '',
          `${authorName} ha respondido a tu mensaje en el foro.`,
          '',
          `Tu mensaje: ${excerpt(original?.texto)}`,
          `Respuesta: ${excerpt(reply.texto)}`,
          '',
          `Ver respuesta: ${forumUrl}`
        ].join('\n'),
        html: buildEmailHtml({
          recipientName,
          authorName,
          replyText: reply.texto,
          originalText: original?.texto,
          forumUrl
        })
      });

      if (!Array.isArray(emailData.accepted) || emailData.accepted.length === 0) {
        throw new Error('Gmail no acepto el destinatario');
      }

      await supabase
        .from('foro_email_deliveries')
        .update({ sent_at: new Date().toISOString(), error: null })
        .eq('message_id', messageId);

      return res.status(200).json({ success: true, sent: true });
    } catch (emailError) {
      await supabase
        .from('foro_email_deliveries')
        .delete()
        .eq('message_id', messageId);
      throw emailError;
    }
  } catch (error) {
    console.error('[FORO-REPLY] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'No se pudo enviar la notificacion'
    });
  }
};
