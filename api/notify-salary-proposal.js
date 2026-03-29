const { Resend } = require('resend');

const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Portal Estiba VLC <onboarding@resend.dev>';
const NOTIFY_TO_EMAIL = 'portalestibavlc@gmail.com';

function parseDataUrlAttachment(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    base64: match[2]
  };
}

function formatAmount(value) {
  if (value === null || value === undefined || value === '') return 'No indicado';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'No indicado';
  return `${amount.toFixed(2)} EUR`;
}

function createEmailHtml(payload) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nueva propuesta salarial</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;background:#f3f4f6;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#0a2e5c;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;">Nueva propuesta de actualizacion salarial</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;color:#111827;">
              <p style="margin:0 0 16px 0;">Se ha enviado una nueva propuesta desde Sueldometro.</p>
              <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="border:1px solid #e5e7eb;"><strong>ID propuesta</strong></td><td style="border:1px solid #e5e7eb;">${payload.proposal_id || 'No disponible'}</td></tr>
                <tr><td style="border:1px solid #e5e7eb;"><strong>Chapa</strong></td><td style="border:1px solid #e5e7eb;">${payload.chapa || 'No disponible'}</td></tr>
                <tr><td style="border:1px solid #e5e7eb;"><strong>Ano</strong></td><td style="border:1px solid #e5e7eb;">${payload.anio_vigencia || 'No disponible'}</td></tr>
                <tr><td style="border:1px solid #e5e7eb;"><strong>Jornada</strong></td><td style="border:1px solid #e5e7eb;">${payload.clave_jornada || 'No disponible'}</td></tr>
                <tr><td style="border:1px solid #e5e7eb;"><strong>G1</strong></td><td style="border:1px solid #e5e7eb;">${formatAmount(payload.jornal_base_g1)}</td></tr>
                <tr><td style="border:1px solid #e5e7eb;"><strong>G2</strong></td><td style="border:1px solid #e5e7eb;">${formatAmount(payload.jornal_base_g2)}</td></tr>
                <tr><td style="border:1px solid #e5e7eb;"><strong>OC / R-E</strong></td><td style="border:1px solid #e5e7eb;">${formatAmount(payload.jornal_oc)}</td></tr>
                <tr><td style="border:1px solid #e5e7eb;"><strong>Contrato adjunto</strong></td><td style="border:1px solid #e5e7eb;">${payload.contract_file_name || 'Sin adjunto'}</td></tr>
              </table>
              ${payload.comentario ? `<p style="margin:16px 0 0 0;"><strong>Comentario:</strong><br>${payload.comentario}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function createEmailText(payload) {
  return [
    'Nueva propuesta de actualizacion salarial',
    '',
    `ID propuesta: ${payload.proposal_id || 'No disponible'}`,
    `Chapa: ${payload.chapa || 'No disponible'}`,
    `Ano: ${payload.anio_vigencia || 'No disponible'}`,
    `Jornada: ${payload.clave_jornada || 'No disponible'}`,
    `G1: ${formatAmount(payload.jornal_base_g1)}`,
    `G2: ${formatAmount(payload.jornal_base_g2)}`,
    `OC / R-E: ${formatAmount(payload.jornal_oc)}`,
    `Contrato adjunto: ${payload.contract_file_name || 'Sin adjunto'}`,
    '',
    `Comentario: ${payload.comentario || 'Sin comentario'}`
  ].join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Metodo no permitido' });
  }

  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ success: false, message: 'Falta configurar RESEND_API_KEY' });
    }

    const payload = req.body || {};
    if (!payload.chapa || !payload.clave_jornada) {
      return res.status(400).json({ success: false, message: 'Faltan datos de la propuesta' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const attachment = parseDataUrlAttachment(payload.contract_file_data);
    const attachments = attachment && payload.contract_file_name
      ? [{
          filename: payload.contract_file_name,
          content: attachment.base64
        }]
      : undefined;

    const { error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: NOTIFY_TO_EMAIL,
      subject: `Nueva propuesta salarial ${payload.clave_jornada} - Chapa ${payload.chapa}`,
      html: createEmailHtml(payload),
      text: createEmailText(payload),
      attachments
    });

    if (error) {
      console.error('[SALARY-PROPOSAL] Error enviando email:', error);
      return res.status(500).json({ success: false, message: 'No se pudo enviar el correo' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[SALARY-PROPOSAL] Error inesperado:', error);
    return res.status(500).json({ success: false, message: 'Error interno al enviar el correo' });
  }
};
