// server.js (o index.js) COMPLETO Y ACTUALIZADO
const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors'); // Asegúrate de que esto esté en package.json
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 5000;

// --- INICIO DE LA MODIFICACIÓN ---
// Habilitar CORS para TODOS los orígenes.
// Esto es más simple y solucionará el error 'Access-Control-Allow-Origin'.
// IMPORTANTE: Pon esto ANTES de app.use(bodyParser.json());
app.use(cors());
// --- FIN DE LA MODIFICACIÓN ---

app.use(bodyParser.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
     console.error("ERROR: Las credenciales de Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) no están configuradas en las variables de entorno.");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY, 
    privateKey: process.env.VAPID_PRIVATE_KEY, 
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
    console.error("ERROR: Las claves VAPID (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) no están configuradas en las variables de entorno.");
}
if (!process.env.WEB_PUSH_EMAIL) {
    console.error("ERROR: El email de Web Push (WEB_PUSH_EMAIL) no está configurado en las variables de entorno.");
}

webpush.setVapidDetails(
    `mailto:${process.env.WEB_PUSH_EMAIL}`, 
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// 1. Ruta para guardar la suscripción del usuario (desde el frontend)
app.post('/api/push/subscribe', async (req, res) => {
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
});

// 2. Ruta para eliminar la suscripción del usuario
app.post('/api/push/unsubscribe', async (req, res) => {
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
});

// 3. Ruta para ENVIAR una notificación de "Nueva Contratación" (llamada por la Edge Function)
app.post('/api/push/notify-new-hire', async (req, res) => {
    const { title, body, url, chapa_target = null } = req.body;
    
    let { data: subscriptions, error } = await supabase
        .from('push_subscriptions')
        .select('*');

    if (error) {
        console.error('Error al obtener suscripciones de Supabase:', error);
        return res.status(500).json({ error: 'Failed to retrieve subscriptions.' });
    }

    let targetSubscriptions = subscriptions || []; 

    if (chapa_target) {
        targetSubscriptions = targetSubscriptions.filter(sub => sub.user_chapa === chapa_target.toString());
        console.log(`Filtrando notificaciones para chapa_target: ${chapa_target}. Suscripciones encontradas: ${targetSubscriptions.length}`);
        if (targetSubscriptions.length === 0) {
            return res.status(200).json({ message: `No active subscriptions found for chapa_target: ${chapa_target}.` });
        }
    } else {
        console.log('No se proporcionó chapa_target. Enviando a TODOS los suscriptores.');
    }

    const payload = JSON.stringify({
        title: title || '¡Nueva Contratación Disponible!',
        body: body || 'Revisa los detalles de la última incorporación a nuestro equipo.',
        url: url || '/', 
    });

    console.log(`Enviando notificación a ${targetSubscriptions.length} suscriptores persistentes...`);

    const notificationsPromises = targetSubscriptions.map(async (sub, index) => {
        const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
            }
        };
        try {
            await webpush.sendNotification(pushSubscription, payload);
            console.log(`Notificación enviada a suscriptor ${index + 1} (chapa: ${sub.user_chapa || 'N/A'})`);
            return { endpoint: sub.endpoint, status: 'success', remove: false };
        } catch (error) {
            console.error(`Error enviando notificación a suscriptor ${index + 1} (chapa: ${sub.user_chapa || 'N/A'}, endpoint: ${sub.endpoint}):`, error);
            if (error.statusCode === 410 || error.statusCode === 404) {
                console.log(`Suscripción inválida/expirada eliminada de BD: ${sub.endpoint}`);
                await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                return { endpoint: sub.endpoint, status: 'failed', remove: true };
            }
            return { endpoint: sub.endpoint, status: 'failed', remove: false };
        }
    });

    await Promise.allSettled(notificationsPromises); 

    console.log(`Finalizado el envío de notificaciones.`);
    res.status(200).json({ 
        message: 'Notifications process initiated. Check logs for individual results.', 
    });
});

app.listen(port, () => {
    console.log(`Backend de notificaciones corriendo en http://localhost:${port}`);
    console.log('VAPID Public Key (para tu frontend):', vapidKeys.publicKey || 'NO CONFIGURADA (VER VAR. ENTORNO)');
    console.log('¡No compartas la VAPID Private Key!');
});
