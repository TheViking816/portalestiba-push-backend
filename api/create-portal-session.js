/**
 * Endpoint para crear sesiones del Stripe Customer Portal
 * POST /api/create-portal-session
 *
 * Permite a los usuarios gestionar su suscripción:
 * - Ver facturas
 * - Actualizar método de pago
 * - Cancelar suscripción
 * - Ver historial de pagos
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Cliente de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Manejar preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { chapa } = req.body;

    if (!chapa) {
      return res.status(400).json({
        error: 'Missing required field: chapa'
      });
    }

    console.log('Creating portal session for chapa:', chapa);

    // Obtener el customer_id de Stripe desde Supabase
    const { data: usuario, error: dbError } = await supabase
      .from('usuarios_premium')
      .select('stripe_customer_id')
      .eq('chapa', chapa)
      .single();

    if (dbError || !usuario) {
      console.error('❌ Usuario no encontrado:', dbError);
      return res.status(404).json({
        error: 'Usuario no encontrado o sin suscripción activa'
      });
    }

    if (!usuario.stripe_customer_id) {
      return res.status(404).json({
        error: 'No se encontró información de cliente en Stripe'
      });
    }

    console.log('Found Stripe customer ID:', usuario.stripe_customer_id);

    // Crear sesión del Customer Portal
    const session = await stripe.billingPortal.sessions.create({
      customer: usuario.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL || 'https://portal-estiba-vlc.vercel.app/'}?portal=return`,
    });

    console.log('✅ Portal session created:', session.id);

    res.status(200).json({
      url: session.url,
    });

  } catch (error) {
    console.error('❌ Error creating portal session:', error);
    res.status(500).json({
      error: error.message,
      type: error.type,
    });
  }
};
