// api/push/subscribe.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

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

    const subscription = req.body;
    const user_chapa = req.body.user_chapa || null;

    console.log('Received subscription request. Body:', subscription);

    if (!subscription || typeof subscription !== 'object' ||
        !subscription.endpoint || typeof subscription.endpoint !== 'string' ||
        !subscription.keys || typeof subscription.keys !== 'object' ||
        !subscription.keys.p256dh || typeof subscription.keys.p256dh !== 'string' ||
        !subscription.keys.auth || typeof subscription.keys.auth !== 'string') {
        console.error('Invalid subscription: Missing or invalid required fields.');
        return res.status(400).json({ error: 'Invalid subscription format: missing or invalid required fields.' });
    }

    try {
        const { data, error } = await supabase
            .from('push_subscriptions')
            .upsert({
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                user_chapa: user_chapa
            }, {
                onConflict: 'endpoint'
            });

        if (error) {
            console.error('Error al guardar suscripción en Supabase:', error);
            return res.status(500).json({ error: 'Failed to save subscription in database.' });
        }

        console.log('Suscripción registrada/actualizada en Supabase:', subscription.endpoint, user_chapa ? `(chapa: ${user_chapa})` : '(sin chapa)');
        res.status(201).json({ message: 'Subscription saved and persisted.' });

    } catch (e) {
        console.error('Excepción al suscribir:', e);
        res.status(500).json({ error: 'Internal server error during subscription process.' });
    }
};
