// api/push/notify-new-hire.js
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
