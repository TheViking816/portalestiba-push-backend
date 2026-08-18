const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const url = process.env.APP_CPE_SUPABASE_URL;
  const key = process.env.APP_CPE_SUPABASE_SERVICE_ROLE;
  const resendKey = process.env.RESEND_API_KEY;
  if (!url || !key || !resendKey) return res.status(503).json({ ok: false, configured: false });
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const resend = new Resend(resendKey);
  const { data: rows, error } = await supabase.from('app_cpe_activation_email_outbox').select('id,kind,recipient,chapa,attempts,status').in('status', ['pending', 'failed']).lt('attempts', 5).order('created_at').limit(20);
  if (error) return res.status(500).json({ ok: false });
  let sent = 0;
  for (const row of rows || []) {
    const { data: claimed } = await supabase.from('app_cpe_activation_email_outbox').update({ status: 'processing' }).eq('id', row.id).eq('status', row.status).select('id').maybeSingle();
    if (!claimed) continue;
    const admin = row.kind === 'admin_pending';
    const subject = admin ? `Nuevo usuario pendiente: chapa ${row.chapa}` : 'Tu cuenta de App CPE ya está activada';
    const html = admin
      ? `<h2>Nuevo usuario pendiente</h2><p>La chapa <strong>${row.chapa}</strong> ha guardado sus claves del portal.</p><p>Cuando estés delante del PC, pasa Cloudflare y ejecuta <strong>Actualizar pendientes App CPE</strong>.</p>`
      : `<h2>Tu cuenta ya está activada</h2><p>Ya hemos sincronizado el portal de la chapa <strong>${row.chapa}</strong>.</p><p>Puedes entrar en App CPE y consultar tus datos.</p>`;
    const { error: emailError } = await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL || 'Portal Estiba VLC <onboarding@resend.dev>', to: row.recipient, subject, html });
    await supabase.from('app_cpe_activation_email_outbox').update(emailError
      ? { status: 'failed', attempts: row.attempts + 1, last_error: 'Resend rechazó el correo' }
      : { status: 'sent', attempts: row.attempts + 1, last_error: null, sent_at: new Date().toISOString() }).eq('id', row.id);
    if (!emailError) sent += 1;
  }
  return res.status(200).json({ ok: true, sent });
};
