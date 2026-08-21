// api/push/notify-new-hire.js
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function emailErrorMessage(error) {
    return String(error?.message || error?.name || 'Error desconocido').slice(0, 500);
}

async function deliverActivationEmail({ message }) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        throw new Error('Gmail de Portal Estiba VLC no está configurado');
    }

    const gmail = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });
    await gmail.sendMail({
        ...message,
        from: `Portal Estiba VLC <${process.env.GMAIL_USER}>`
    });
    return 'gmail';
}

async function sendAppCpeActivationEmails(res) {
    const appCpe = createClient(process.env.APP_CPE_SUPABASE_URL, process.env.APP_CPE_SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: rows, error } = await appCpe.from('app_cpe_activation_email_outbox').select('id,kind,recipient,chapa,attempts,status').in('status', ['pending', 'failed']).lt('attempts', 5).order('created_at').limit(20);
    if (error) return res.status(500).json({ ok: false });
    let sent = 0;
    let failed = 0;
    for (const row of rows || []) {
        const { data: claimed } = await appCpe.from('app_cpe_activation_email_outbox').update({ status: 'processing' }).eq('id', row.id).eq('status', row.status).select('id').maybeSingle();
        if (!claimed) continue;
        const admin = row.kind === 'admin_pending';
        const message = {
            to: row.recipient,
            subject: admin ? `Nuevo usuario pendiente: chapa ${row.chapa}` : 'Tu cuenta de App CPE ya está activada',
            html: admin
                ? `<h2>Nuevo usuario pendiente</h2><p>La chapa <strong>${row.chapa}</strong> ha guardado sus claves del portal.</p><p>Pasa Cloudflare y ejecuta <strong>Actualizar pendientes App CPE</strong>.</p>`
                : `<h2>Tu cuenta ya está activada</h2><p>Ya hemos sincronizado el portal de la chapa <strong>${row.chapa}</strong>.</p><p>Puedes entrar en App CPE y consultar tus datos.</p><p><a href="https://cpe-app-flax.vercel.app">Abrir App CPE</a></p>`
        };
        try {
            const provider = await deliverActivationEmail({ message });
            await appCpe.from('app_cpe_activation_email_outbox').update({
                status: 'sent',
                attempts: row.attempts + 1,
                last_error: null,
                sent_at: new Date().toISOString()
            }).eq('id', row.id);
            console.log(`Correo de activación ${row.id} enviado mediante ${provider}`);
            sent += 1;
        } catch (emailError) {
            const lastError = emailErrorMessage(emailError);
            console.error(`No se pudo enviar el correo de activación ${row.id}: ${lastError}`);
            await appCpe.from('app_cpe_activation_email_outbox').update({
                status: 'failed',
                attempts: row.attempts + 1,
                last_error: lastError
            }).eq('id', row.id);
            failed += 1;
        }
    }
    return res.status(200).json({ ok: true, sent, failed });
}

// Configurar VAPID
webpush.setVapidDetails(
    `mailto:${process.env.WEB_PUSH_EMAIL || 'noreply@portalestibavlc.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {
    // Habilitar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        if (req.body?.app_cpe_activation_emails === true) {
            if (!process.env.APP_CPE_SUPABASE_URL || !process.env.APP_CPE_SUPABASE_SERVICE_ROLE || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
                return res.status(503).json({ ok: false, configured: false });
            }
            return await sendAppCpeActivationEmails(res);
        }
        const { title, body, url, chapa_target = null } = req.body;

        console.log(`📨 Notificación nueva contratación para chapa: ${chapa_target || 'TODOS'}`);

        // Obtener suscripciones de la tabla push_subscriptions
        let { data: subscriptions, error } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (error) {
            console.error('Error obteniendo suscripciones:', error);
            return res.status(500).json({ error: 'Failed to retrieve subscriptions' });
        }

        let targetSubscriptions = subscriptions || [];

        // Filtrar por chapa si se especificó
        if (chapa_target) {
            targetSubscriptions = targetSubscriptions.filter(
                sub => sub.user_chapa === chapa_target.toString()
            );
            console.log(`✅ Suscripciones encontradas para chapa ${chapa_target}: ${targetSubscriptions.length}`);

            if (targetSubscriptions.length === 0) {
                return res.status(200).json({
                    message: `No subscriptions found for chapa ${chapa_target}`
                });
            }
        }

        const payload = JSON.stringify({
            title: title || '¡Nueva Contratación!',
            body: body || 'Hay una nueva contratación disponible',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: {
                url: url || '/contratacion'
            }
        });

        console.log(`📤 Enviando a ${targetSubscriptions.length} suscriptores...`);

        // Enviar notificaciones
        const results = await Promise.allSettled(
            targetSubscriptions.map(async (sub) => {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                };

                try {
                    await webpush.sendNotification(pushSubscription, payload);
                    console.log(`✅ Notificación enviada a chapa ${sub.user_chapa}`);
                    return { success: true, chapa: sub.user_chapa };
                } catch (error) {
                    console.error(`❌ Error enviando a chapa ${sub.user_chapa}:`, error.message);

                    // Si la suscripción está expirada, eliminarla
                    if (error.statusCode === 410 || error.statusCode === 404) {
                        await supabase
                            .from('push_subscriptions')
                            .delete()
                            .eq('endpoint', sub.endpoint);
                        console.log(`🗑️ Suscripción expirada eliminada: ${sub.user_chapa}`);
                    }

                    return { success: false, chapa: sub.user_chapa, error: error.message };
                }
            })
        );

        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const failed = results.length - successful;

        console.log(`📊 Resumen: ${successful} exitosas, ${failed} fallidas`);

        return res.status(200).json({
            success: true,
            message: 'Notifications sent',
            total: targetSubscriptions.length,
            successful,
            failed
        });

    } catch (error) {
        console.error('❌ Error en notify-new-hire:', error);
        return res.status(500).json({ error: error.message });
    }
};
