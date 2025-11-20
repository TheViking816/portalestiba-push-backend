const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Procesar evento
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionCancelled(event.data.object);
      break;
  }

  res.json({ received: true });
}

async function handleSubscriptionUpdate(subscription) {
  const chapa = subscription.metadata.chapa;

  await supabase.from('usuarios_premium').upsert({
    chapa,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    plan_tipo: 'premium_mensual',
    estado: subscription.status,
    fecha_inicio: new Date(subscription.current_period_start * 1000),
    fecha_fin: new Date(subscription.current_period_end * 1000),
    sueldometro_habilitado: true,
    oraculo_habilitado: true,
    chatbot_ia_habilitado: true
  });
}

async function handleSubscriptionCancelled(subscription) {
  const chapa = subscription.metadata.chapa;

  await supabase.from('usuarios_premium').update({
    estado: 'cancelled',
    fecha_cancelacion: new Date()
  }).eq('chapa', chapa);
}
