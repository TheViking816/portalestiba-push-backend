const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 5000;

// ===================================================================
//  INICIO DE LA MODIFICACIÓN: Configuración de CORS
//  Esto reemplaza a la línea "app.use(cors());"
// ===================================================================

// Lista de orígenes (dominios) permitidos
const allowedOrigins = [
  'http://127.0.0.1:2008', // Tu frontend local
  'http://localhost:2008', // Otra variación local
  // 'https://tu-pwa-en-produccion.com' // <-- AÑADE TU URL DE PRODUCCIÓN AQUÍ MÁS TARDE
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir peticiones sin 'origin' (como Postman) o si está en la lista blanca
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.error(`Origen no permitido por CORS: ${origin}`);
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: "GET,POST,PUT,DELETE,OPTIONS", // Permitir estos métodos
  allowedHeaders: "Content-Type, Authorization, X-Requested-With", // Permitir estos headers
  optionsSuccessStatus: 200 // Responde OK a las peticiones OPTIONS (pre-flight)
};

// Habilitar CORS con opciones
// IMPORTANTE: Esto debe ir ANTES de app.use(bodyParser.json()) y tus rutas.
app.use(cors(corsOptions));

// ===================================================================
//  FIN DE LA MODIFICACIÓN
// ===================================================================

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
source [149]: console.error('Error al obtener suscripciones de Supabase:', error);
        return res.status(500).json({ error: 'Failed to retrieve subscriptions.' });
    }

    let targetSubscriptions = subscriptions || []; 

    if (chapa_target) {
        targetSubscriptions = targetSubscriptions.filter(sub => sub.user_chapa === chapa_target.toString());
source [150]:         console.log(`Filtrando notificaciones para chapa_target: ${chapa_target}. Suscripciones encontradas: ${targetSubscriptions.length}`);
        if (targetSubscriptions.length === 0) {
            return res.status(200).json({ message: `No active subscriptions found for chapa_target: ${chapa_target}.` });
        }
    } else {
        console.log('No se proporcionó chapa_target. Enviando a TODOS los suscriptores.');
    }

    // --- ¡MODIFICACIÓN DE AYER! ---
    const payload = JSON.stringify({
        title: title || '¡Nueva Contratación Disponible!',
        body: body || 'Revisa los detalles de la última incorporación a nuestro equipo.',
        url: url || '/#contratacion', // <-- ¡Esto ya está correcto!
    });
    // --- FIN DE LA MODIFICACIÓN ---

    console.log(`Enviando notificación a ${targetSubscriptions.length} suscriptores persistentes...`);

source [151]:     const notificationsPromises = targetSubscriptions.map(async (sub, index) => {
        const pushSubscription = {
            endpoint: sub.endpoint,
source [152]:             keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
            }
        };
        try {
            await webpush.sendNotification(pushSubscription, payload);
source [153]:             console.log(`Notificación enviada a suscriptor ${index + 1} (chapa: ${sub.user_chapa || 'N/A'})`);
            return { endpoint: sub.endpoint, status: 'success', remove: false };
        } catch (error) {
source [154]:             console.error(`Error enviando notificación a suscriptor ${index + 1} (chapa: ${sub.user_chapa || 'N/A'}, endpoint: ${sub.endpoint}):`, error);
            if (error.statusCode === 410 || error.statusCode === 404) {
source [155]:                 console.log(`Suscripción inválida/expirada eliminada de BD: ${sub.endpoint}`);
                await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                return { endpoint: sub.endpoint, status: 'failed', remove: true };
tengo este error ahora
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (Q91Pi44.png, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (7F1BWQ2.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (xcHiyAn.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (7F1BWQ2.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (i.imgur.com, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (i.imgur.com, line 0)
[Log] 🔐 Verificando contraseña para chapa: 9999 (app.js, line 515)
[Log] ✅ Login exitoso para chapa: 9999 (app.js, line 523)
[Log] ✅ Cache de nombres actualizado (app.js, line 592)
[Log] ✅ Supabase inicializado correctamente (supabase.js, line 43)
[Log] 🔄 Iniciando auto-refresh para primas e IRPF (cada 5 minutos)... (app.js, line 269)
[Log] 📍 Navegando por hash: dashboard (app.js, line 249)
[Log] 📦 Cache HIT: supabase_censo_actual (edad: 4s) (supabase.js, line 161)
[Log] 📅 Fecha encontrada: 16/11/2025 (supabase.js, line 752)
[Log] ✅ Puertas procesadas: 5 jornadas (supabase.js, line 785)
[Log] ✅ Última jornada contratada (SP): 08-14 - Puerta: 153 (supabase.js, line 1520)
[Log] ✅ Última jornada contratada (OC): 08-14 - Puerta: 498 (supabase.js, line 1520)
[Log] 🔄 Auto-refresh: Actualizando primas e IRPF desde Supabase... (app.js, line 286)
[Log] 📥 Cargando primas personalizadas desde Supabase... (supabase.js, line 1079)
[Log] 🔍 DEBUG PRIMAS: Buscando primas para chapa: 9999, fechaInicio: null, fechaFin: null (supabase.js, line 1082)
[Log] 🔍 DEBUG PRIMAS: Query result - 0 registros encontrados (supabase.js, line 1099)
[Log] 🔍 DEBUG PRIMAS: Primer registro: undefined (supabase.js, line 1100)
[Log] 🔍 DEBUG PRIMAS: Error: null (supabase.js, line 1101)
[Log] 🔍 DEBUG PRIMAS: Fecha convertida del primer registro: undefined (supabase.js, line 1111)
[Log] ✅ 0 primas personalizadas cargadas desde Supabase (supabase.js, line 1332)
[Log] 🔍 DEBUG: Buscando configuración para chapa: 9999 (supabase.js, line 1035)
[Log] 🔍 DEBUG: Query result - data: null error: null (supabase.js, line 1043)
[Log] 🔍 DEBUG: Config antes de normalizar: {chapa: '9999', irpf_porcentaje: 2} (supabase.js, line 1048)
[Log] ✅ DEBUG: IRPF normalizado de 2 a 2 (supabase.js, line 1053)
[Log] 🔍 DEBUG: Config final: {chapa: '9999', irpf_porcentaje: 2, irpf: 2} (supabase.js, line 1056)
[Log] ✅ Auto-refresh completado: (app.js, line 304)
[Log] {irpf: 2, primas: 0}
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (i.imgur.com, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (i.imgur.com, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (i.imgur.com, line 0)
[Log] Push: Inicializando notificaciones. ¿Usuario autenticado? true Chapa: 9999 (index.html, line 881)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (Q91Pi44.png, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (Q91Pi44.png, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (Q91Pi44.png, line 0)
[Log] 📍 Navegando por hash: push-notifications (app.js, line 249)
[Log] Navegando a la página de Notificaciones Push. (app.js, line 783)
[Log] Push: Inicializando notificaciones. ¿Usuario autenticado? true Chapa: 9999 (index.html, line 881)
[Log] 📥 Sincronizando jornales desde CSV pivotado... (supabase.js, line 214)
[Log] 📍 URL: https://docs.google.com/spreadsheets/d/e/2PACX-1vSTtbkA94xqjf81lsR7bLKKtyES2YBDKs8J2T4UrSEan7e5Z_eaptShCA78R1wqUyYyASJxmHj3gDnY/pub?gid=1388412839&single=true&output=csv (supabase.js, line 216)
[Log] ✅ CSV descargado: 21321 caracteres, 114 líneas (supabase.js, line 249)
[Log] 📄 Primeros 200 chars: Fecha,Jornada,Empresa,Parte,Buque,T,TC,C1,B,E
10/11/24,02-08,DGI,1,MSC MASHA,702,,,,
10/11/24,08-14,DGI,2,MSC MASHA,705,,,,
10/11/24,14-20,DGI,1,MSC MASHA,,,,,
10/11/24,20-02,DGI,2,MSC MASHA,,,,,
10/11/24,F (supabase.js, line 250)
[Log] 📊 Headers (10): Fecha, Jornada, Empresa, Parte, Buque, T, TC, C1, B, E (supabase.js, line 253)
[Log] 📋 Filas parseadas: 113 (supabase.js, line 254)
[Log] 🗺️ Índices mapeados: {fecha: 0, jornada: 1, empresa: 2, parte: 3, buque: 4, t: 5, tc: 6, c1: 7, b: 8, e: 9} (supabase.js, line 298)
[Log] ✅ 247 jornales despivotados (supabase.js, line 372)
[Log] ⚠️ 35 filas ignoradas (datos inválidos o incompletos) (supabase.js, line 373)
[Log] 📦 Ejemplo de jornal despivotado: {fecha: '2024-11-10', chapa: '702', puesto: 'Trincador', jornada: '02-08', empresa: 'DGI', buque: 'MSC MASHA', parte: '1', origen: 'csv'} (supabase.js, line 375)
[Log] 💾 Insertando 247 jornales usando upsert... (supabase.js, line 380)
[Log] ✅ Sincronización completa: 247 jornales procesados (nuevos o actualizados), 0 errores (supabase.js, line 421)
[Log] 📥 Cargando jornales del usuario desde Supabase... (app.js, line 957)
[Log] 📥 Cargando jornales del usuario: 9999 (supabase.js, line 862)
[Log] 📦 Cache HIT: supabase_jornales_9999_all_all_all (edad: 3s) (supabase.js, line 161)
[Log] 📊 0 jornales filtrados para los próximos 3 días (app.js, line 976)
[Log] ✅ 0 jornales cargados: 0 del CSV + 0 manuales + 0 otros (app.js, line 1188)
[Log] 📦 Cache HIT: supabase_mapeo_puestos (edad: 3s) (supabase.js, line 161)
[Log] 📦 Cache HIT: supabase_tabla_salarios (edad: 3s) (supabase.js, line 161)
[Log] 🔧 APLICANDO WORKAROUND DE SÁBADOS Y FEST-FEST... (supabase.js, line 1205)
[Log] 🔄 Reemplazando clave: 08-14_SABADO (supabase.js, line 1213)
[Log] 🔄 Reemplazando clave: 14-20_SABADO (supabase.js, line 1213)
[Log] 🔄 Reemplazando clave: 20-02_SABADO (supabase.js, line 1213)
[Log] ➕ Añadiendo clave nueva: 02-08_FEST-FEST (supabase.js, line 1216)
[Log] ✅ WORKAROUND APLICADO - Claves de sábado y FEST-FEST forzadas en memoria (supabase.js, line 1221)
[Log] 🚀 DEBUG: loadSueldometro() ejecutándose - timestamp: 2025-11-16T00:30:11.964Z (app.js, line 2531)
[Log] 🧹 DEBUG: Limpiando contenido anterior (app.js, line 2537)
[Log] 🔍 DEBUG: Buscando configuración para chapa: 9999 (supabase.js, line 1035)
[Log] 📦 Cache HIT: supabase_config_9999 (edad: 4s) (supabase.js, line 161)
[Log] 🔍 DEBUG: Config antes de normalizar: {chapa: '9999', irpf_porcentaje: 2, irpf: 2} (supabase.js, line 1048)
[Log] 🔍 DEBUG: Config final: {chapa: '9999', irpf_porcentaje: 2, irpf: 2} (supabase.js, line 1056)
[Log] ✅ IRPF cargado desde Supabase: 2% (supabase.js, line 1040)
[Log] 💰 IRPF cargado: 2% (bloqueado: false) (app.js, line 2557)
[Log] 🗑️ Cache de jornales, primas, mapeo_puestos y tabla_salarios limpiado en Sueldómetro (app.js, line 2577)
[Log] 🔄 Sincronizando primas personalizadas desde CSV... (app.js, line 2582)
[Log] 📥 Sincronizando primas personalizadas desde CSV... (supabase.js, line 503)
[Log] 📊 Headers CSV Primas: Chapa, Fecha, Jornada, Prima_Personalizada, Movimientos_Personalizados, Relevo, Remate (supabase.js, line 527)
[Log] 📋 Filas de primas: 0 (supabase.js, line 528)
[Log] 🗺️ Índices de primas mapeados: {chapa: 0, fecha: 1, jornada: 2, prima_personalizada: 3, movimientos_personalizados: 4, relevo: 5, remate: 6} (supabase.js, line 572)
[Log] 📊 0 primas parseadas del CSV (supabase.js, line 630)
[Log] 📊 Cargando datos del Sueldómetro... (app.js, line 2592)
[Log] 📥 Cargando jornales del usuario: 9999 (supabase.js, line 862)
[Log] 📥 Cargando mapeo de puestos (supabase.js, line 1164)
[Log] 📥 Cargando tabla de salarios (supabase.js, line 1189)
[Log] ✅ 0 jornales: 0 del CSV + 0 manuales + 0 otros (app.js, line 2603)
[Log]    0 puestos, 18 salarios (app.js, line 2604)
[Log] 🔧 APLICANDO WORKAROUND DE SÁBADOS Y FEST-FEST... (supabase.js, line 1205)
[Log] 🔄 Reemplazando clave: 08-14_SABADO (supabase.js, line 1213)
[Log] 🔄 Reemplazando clave: 14-20_SABADO (supabase.js, line 1213)
[Log] 🔄 Reemplazando clave: 20-02_SABADO (supabase.js, line 1213)
[Log] ➕ Añadiendo clave nueva: 02-08_FEST-FEST (supabase.js, line 1216)
[Log] ✅ WORKAROUND APLICADO - Claves de sábado y FEST-FEST forzadas en memoria (supabase.js, line 1221)
[Log] ✅ 22 registros de tabla salarial cargados (supabase.js, line 1226)
[Log] ✅ 0 registros de mapeo de puestos cargados (supabase.js, line 1178)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (bSOecVC.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (C3UpaWV.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (gUw97fH.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (iHJOi0K.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (7F1BWQ2.jpeg, line 0)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (xcHiyAn.jpeg, line 0)
[Log] 📅 Fecha encontrada: 16/11/2025 (supabase.js, line 752)
[Log] ✅ Puertas procesadas: 5 jornadas (supabase.js, line 785)
[Log] 📦 Cache HIT: supabase_censo_actual (edad: 11s) (supabase.js, line 161)
[Log] 📥 Cargando mensajes del foro desde Supabase... (app.js, line 2023)
[Log] 📥 Cargando usuarios (para cache de nombres) (supabase.js, line 951)
[Log] 📥 Cargando mensajes del foro, límite 50 (supabase.js, line 1133)
[Log] 📦 Cache HIT: supabase_usuarios (edad: 11s) (supabase.js, line 161)
[Log] ✅ Cache de nombres actualizado (app.js, line 2046)
[Log] ✅ 0 mensajes cargados desde Supabase (app.js, line 2052)
[Log] ⚠️ No hay mensajes en Supabase, usando localStorage (app.js, line 2055)
[Log] 📂 0 mensajes cargados desde localStorage (app.js, line 2070)
[Error] Failed to load resource: the server responded with a status of 403 (Forbidden) (bSOecVC.jpeg, line 0)
[Log] 🚀 DEBUG: loadSueldometro() ejecutándose - timestamp: 2025-11-16T00:30:12.181Z (app.js, line 2531)
[Log] 🧹 DEBUG: Limpiando contenido anterior (app.js, line 2537)
[Log] 🔍 DEBUG: Buscando configuración para chapa: 9999 (supabase.js, line 1035)
[Log] 📦 Cache HIT: supabase_config_9999 (edad: 4s) (supabase.js, line 161)
[Log] 🔍 DEBUG: Config antes de normalizar: {chapa: '9999', irpf_porcentaje: 2, irpf: 2} (supabase.js, line 1048)
[Log] ✅ DEBUG: IRPF normalizado de 2 a 2 (supabase.js, line 1053)
[Log] 🔍 DEBUG: Config final: {chapa: '9999', irpf_porcentaje: 2, irpf: 2} (supabase.js, line 1056)
[Log] ✅ IRPF cargado desde Supabase: 2% (supabase.js, line 1040)
[Log] 💰 IRPF cargado: 2% (bloqueado: false) (app.js, line 2557)
[Log] 🗑️ Cache de jornales, primas, mapeo_puestos y tabla_salarios limpiado en Sueldómetro (app.js, line 2577)
[Log] 🔄 Sincronizando primas personalizadas desde CSV... (app.js, line 2582)
[Log] 📥 Sincronizando primas personalizadas desde CSV... (supabase.js, line 503)
[Log] 📊 Headers CSV Primas: Chapa, Fecha, Jornada, Prima_Personalizada, Movimientos_Personalizados, Relevo, Remate (supabase.js, line 527)
[Log] 📋 Filas de primas: 0 (supabase.js, line 528)
[Log] 🗺️ Índices de primas mapeados: {chapa: 0, fecha: 1, jornada: 2, prima_personalizada: 3, movimientos_personalizados: 4, relevo: 5, remate: 6} (supabase.js, line 572)
[Log] 📊 0 primas parseadas del CSV (supabase.js, line 630)
[Log] 📊 Cargando datos del Sueldómetro... (app.js, line 2592)
[Log] 📥 Cargando jornales del usuario: 9999 (supabase.js, line 862)
[Log] 📥 Cargando mapeo de puestos (supabase.js, line 1164)
[Log] 📥 Cargando tabla de salarios (supabase.js, line 1189)
[Log] ✅ 0 jornales: 0 del CSV + 0 manuales + 0 otros (app.js, line 2603)
[Log]    0 puestos, 18 salarios (app.js, line 2604)
[Log] 🔧 APLICANDO WORKAROUND DE SÁBADOS Y FEST-FEST... (supabase.js, line 1205)
[Log] 🔄 Reemplazando clave: 08-14_SABADO (supabase.js, line 1213)
[Log] 🔄 Reemplazando clave: 14-20_SABADO (supabase.js, line 1213)
Posiblemente sea eso, ahora mismo lo hago, si no funciona te digo, gracias
[Log] 🔄 Reemplazando clave: 20-02_SABADO (supabase.js, line 1213)
[Log] ➕ Añadiendo clave nueva: 02-08_FEST-FEST (supabase.js, line 1216)
[Log] ✅ WORKAROUND APLICADO - Claves de sábado y FEST-FEST forzadas en memoria (supabase.js, line 1221)
[Log] ✅ 22 registros de tabla salarial cargados (supabase.js, line 1226)
[Log] ✅ 0 registros de mapeo de puestos cargados (supabase.js, line 1178)
[Log] ✅ 0 jornales cargados desde Supabase (app.js, line 1188)
[Log] 📦 Cache HIT: supabase_usuarios (edad: 11s) (supabase.js, line 161)
[Log] 📥 Sincronizando jornales desde CSV pivotado... (supabase.js, line 214)
[Log] 📍 URL: https://docs.google.com/spreadsheets/d/e/2PACX-1vSTtbkA94xqjf81lsR7bLKKtyES2YBDKs8J2T4UrSEan7e5Z_eaptShCA78R1wqUyYyASJxmHj3gDnY/pub?gid=1388412839&single=true&output=csv (supabase.js, line 216)
[Log] ✅ CSV descargado: 21321 caracteres, 114 líneas (supabase.js, line 249)
[Log] 📄 Primeros 200 chars: Fecha,Jornada,Empresa,Parte,Buque,T,TC,C1,B,E
10/11/24,02-08,DGI,1,MSC MASHA,702,,,,
10/11/24,08-14,DGI,2,MSC MASHA,705,,,,
10/11/24,14-20,DGI,1,MSC MASHA,,,,,
10/11/24,20-02,DGI,2,MSC MASHA,,,,,
10/11/24,F (supabase.js, line 250)
[Log] 📊 Headers (10): Fecha, Jornada, Empresa, Parte, Buque, T, TC, C1, B, E (supabase.js, line 253)
[Log] 📋 Filas parseadas: 113 (supabase.js, line 254)
[Log] 🗺️ Índices mapeados: {fecha: 0, jornada: 1, empresa: 2, parte: 3, buque: 4, t: 5, tc: 6, c1: 7, b: 8, e: 9} (supabase.js, line 298)
[Log] ✅ 247 jornales despivotados (supabase.js, line 372)
[Log] ⚠️ 35 filas ignoradas (datos inválidos o incompletos) (supabase.js, line 373)
[Log] 📦 Ejemplo de jornal despivotado: {fecha: '2024-11-10', chapa: '702', puesto: 'Trincador', jornada: '02-08', empresa: 'DGI', buque: 'MSC MASHA', parte: '1', origen: 'csv'} (supabase.js, line 375)
[Log] 💾 Insertando 247 jornales usando upsert... (supabase.js, line 380)
[Log] ✅ Sincronización completa: 247 jornales procesados (nuevos o actualizados), 0 errores (supabase.js, line 421)
[Log] 📥 Cargando todos los jornales desde Supabase... (app.js, line 1184)
[Log] 📥 Cargando jornales del usuario: 9999 (supabase.js, line 862)
[Log] ✅ 0 jornales cargados: 0 del CSV + 0 manuales + 0 otros (app.js, line 1188)
[Log] 📦 Cache HIT: supabase_usuarios (edad: 11s) (supabase.js, line 161)
[Log] 🚀 DEBUG: loadSueldometro() ejecutándose - timestamp: 2025-11-16T00:30:12.378Z (app.js, line 2531)
[Log] 🧹 DEBUG: Limpiando contenido anterior (app.js, line 2537)
[Log] 🔍 DEBUG: Buscando configuración para chapa: 9999 (supabase.js, line 1035)
[Log] 📦 Cache HIT: supabase_config_9999 (edad: 4s) (supabase.js, line 161)
[Log] 🔍 DEBUG: Config antes de normalizar: {chapa: '9999', irpf_porcentaje: 2, irpf: 2} (supabase.js, line 1048)
[Log] ✅ DEBUG: IRPF normalizado de 2 a 2 (supabase.js, line 1053)
[Log] 🔍 DEBUG: Config final: {chapa: '9999', irpf_porcentaje: 2, irpf: 2} (supabase.js, line 1056)
[Log] ✅ IRPF cargado desde Supabase: 2% (supabase.js, line 1040)
[Log] 💰 IRPF cargado: 2% (bloqueado: false) (app.js, line 2557)
[Log] 🗑️ Cache de jornales, primas, mapeo_puestos y tabla_salarios limpiado en Sueldómetro (app.js, line 2577)
[Log] 🔄 Sincronizando primas personalizadas desde CSV... (app.js, line 2582)
[Log] 📥 Sincronizando primas personalizadas desde CSV... (supabase.js, line 503)
[Log] 📊 Headers CSV Primas: Chapa, Fecha, Jornada, Prima_Personalizada, Movimientos_Personalizados, Relevo, Remate (supabase.js, line 527)
[Log] 📋 Filas de primas: 0 (supabase.js, line 528)
[Log] 🗺️ Índices de primas mapeados: {chapa: 0, fecha: 1, jornada: 2, prima_personalizada: 3, movimientos_personalizados: 4, relevo: 5, remate: 6} (supabase.js, line 572)
[Log] 📊 0 primas parseadas del CSV (supabase.js, line 630)
[Log] 📊 Cargando datos del Sueldómetro... (app.js, line 2592)
[Log] 📥 Cargando jornales del usuario: 9999 (supabase.js, line 862)
[Log] 📥 Cargando mapeo de puestos (supabase.js, line 1164)
[Log] 📥 Cargando tabla de salarios (supabase.js, line 1189)
[Log] ✅ 0 jornales: 0 del CSV + 0 manuales + 0 otros (app.js, line 2603)
[Log]    0 puestos, 18 salarios (app.js, line 2604)
[Log] 🔧 APLICANDO WORKAROUND DE SÁBADOS Y FEST-FEST... (supabase.js, line 1205)
[Log] 🔄 Reemplazando clave: 08-14_SABADO (supabase.js, line 1213)
[Log] 🔄 Reemplazando clave: 14-20_SABADO (supabase.js, line 1213)
[Log] 🔄 Reemplazando clave: 20-02_SABADO (supabase.js, line 1213)
[Log] ➕ Añadiendo clave nueva: 02-08_FEST-FEST (supabase.js, line 1216)
[Log] ✅ WORKAROUND APLICADO - Claves de sábado y FEST-FEST forzadas en memoria (supabase.js, line 1221)
[Log] ✅ 22 registros de tabla salarial cargados (supabase.js, line 1226)
[Log] ✅ 0 registros de mapeo de puestos cargados (supabase.js, line 1178)
[Log] 📅 Fecha encontrada: 16/11/2025 (supabase.js, line 752)
[Log] ✅ Puertas procesadas: 5 jornadas (supabase.js, line 785)
[Log] 📥 Sincronizando censo desde CSV... (supabase.js, line 390)
[Log] 📋 Headers CSV Censo: posicion, chapa, color (supabase.js, line 407)
[Log] ✅ 546 items de censo parseados del CSV (supabase.js, line 440)
[Log] 🗑️ Censo anterior borrado (supabase.js, line 454)
[Log] ✅ 546 items de censo sincronizados en Supabase (supabase.js, line 475)
[Log] 📥 Cargando censo (supabase.js, line 148)
[Log] ✅ 546 registros de censo cargados (supabase.js, line 185)
[Log] 📦 Cache HIT: supabase_usuarios (edad: 11s) (supabase.js, line 161)
[Log] 📥 Cargando mensajes del foro desde Supabase... (app.js, line 2023)
[Log] 📦 Cache HIT: supabase_usuarios (edad: 11s) (supabase.js, line 161)
[Log] ✅ Cache de nombres actualizado (app.js, line 2046)
[Log] 📦 Cache HIT: supabase_foro_50 (edad: 11s) (supabase.js, line 161)
[Log] ✅ 0 mensajes cargados desde Supabase (app.js, line 2052)
[Log] ⚠️ No hay mensajes en Supabase, usando localStorage (app.js, line 2055)
[Log] 📂 0 mensajes cargados desde localStorage (app.js, line 2070)
[Log] Push: Inicializando notificaciones. ¿Usuario autenticado? true Chapa: 9999 (index.html, line 881)
