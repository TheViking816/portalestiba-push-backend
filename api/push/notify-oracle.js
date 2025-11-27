// api/push/notify-oracle.js
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

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
        const { title, body, url, chapa_target } = req.body;

        if (!chapa_target) {
            return res.status(400).json({ error: 'chapa_target is required for Oracle notifications' });
        }

        console.log(`🔮 Notificación del Oráculo para chapa: ${chapa_target}`);

        // Obtener suscripción del usuario específico
        const { data: subscriptions, error } = await supabase
            .from('push_subscriptions')
            .select('*')
            .eq('user_chapa', chapa_target.toString());

        if (error) {
            console.error('Error obteniendo suscripción:', error);
            return res.status(500).json({ error: 'Failed to retrieve subscription' });
        }

        if (!subscriptions || subscriptions.length === 0) {
            console.log(`⚠️ No hay suscripción para chapa ${chapa_target}`);
            return res.status(200).json({
                success: true,
                message: `No subscription found for chapa ${chapa_target}`
            });
        }

        const subscription = subscriptions[0]; // Tomar la primera suscripción

        const payload = JSON.stringify({
            title: title || '🔮 Tu Oráculo del Día',
            body: body || 'Toca para ver tu probabilidad de trabajar hoy',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: {
                url: url || '/oraculo'
            }
        });

        const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        };

        try {
            await webpush.sendNotification(pushSubscription, payload);
            console.log(`✅ Notificación del Oráculo enviada a chapa ${chapa_target}`);

            return res.status(200).json({
                success: true,
                message: `Oracle notification sent to chapa ${chapa_target}`
            });

        } catch (pushError) {
            console.error(`❌ Error enviando notificación a chapa ${chapa_target}:`, pushError.message);

            // Si la suscripción está expirada, eliminarla
            if (pushError.statusCode === 410 || pushError.statusCode === 404) {
                await supabase
                    .from('push_subscriptions')
                    .delete()
                    .eq('endpoint', subscription.endpoint);
                console.log(`🗑️ Suscripción expirada eliminada para chapa ${chapa_target}`);

                return res.status(200).json({
                    success: false,
                    message: 'Subscription expired and removed',
                    removed: true
                });
            }

            return res.status(500).json({
                success: false,
                error: pushError.message
            });
        }

    } catch (error) {
        console.error('❌ Error en notify-oracle:', error);
        return res.status(500).json({ error: error.message });
    }
};
