// api/push/unsubscribe.js
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

    const endpointToRemove = req.body.endpoint;

    if (!endpointToRemove || typeof endpointToRemove !== 'string') {
        console.error('Invalid unsubscription request: Missing or invalid endpoint.');
        return res.status(400).json({ error: 'Endpoint is required for unsubscription.' });
    }

    try {
        const { error } = await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', endpointToRemove);

        if (error) {
            console.error('Error al eliminar suscripción de Supabase:', error);
            return res.status(500).json({ error: 'Failed to remove subscription from database.' });
        }

        console.log('Suscripción eliminada de Supabase:', endpointToRemove);
        res.status(200).json({ message: 'Subscription removed and unpersisted.' });

    } catch (e) {
        console.error('Excepción al desuscribir:', e);
        res.status(500).json({ error: 'Internal server error during unsubscription process.' });
    }
};
