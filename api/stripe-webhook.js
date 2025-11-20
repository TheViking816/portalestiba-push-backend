const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Vercel proporciona el raw body automáticamente en req.body cuando es Buffer
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);

    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log('✅ Webhook signature verified. Event type:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Procesar evento
  try {
    console.log('Processing event:', event.type);

    switch (event.type) {
      case 'customer.subscription.created':
        console.log('📝 Subscription created');
        await handleSubscriptionUpdate(event.data.object);
        break;

      case 'customer.subscription.updated':
        console.log('📝 Subscription updated');
        await handleSubscriptionUpdate(event.data.object);
        break;

      case 'customer.subscription.deleted':
        console.log('📝 Subscription deleted');
        await handleSubscriptionCancelled(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        console.log('💰 Payment succeeded');
        break;

      case 'invoice.payment_failed':
        console.log('❌ Payment failed');
        break;

      default:
        console.log(ℹ️ Unhandled event type:', event.type);
    }

    return res.json({ received: true, event: event.type });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return res.status(500).json({ error: error.message });
  }
};

async function handleSubscriptionUpdate(subscription) {
  const chapa = subscription.metadata.chapa;

  if (!chapa) {
    console.error('❌ No chapa in subscription metadata');
    throw new Error('No chapa in subscription metadata');
  }

  console.log('📊 Updating subscription for chapa:', chapa);
  console.log('Status:', subscription.status);
  console.log('Period:', new Date(subscription.current_period_start * 1000), 'to', new Date(subscription.current_period_end * 1000));

  const { data, error } = await supabase.from('usuarios_premium').upsert({
    chapa,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    plan_tipo: 'premium_mensual',
    estado: subscription.status,
    fecha_inicio: new Date(subscription.current_period_start * 1000).toISOString(),
    fecha_fin: new Date(subscription.current_period_end * 1000).toISOString(),
    sueldometro_habilitado: true,
    oraculo_habilitado: true,
    chatbot_ia_habilitado: true
  });

  if (error) {
    console.error('❌ Error updating Supabase:', error);
    throw error;
  }

  console.log('✅ Successfully updated premium status for chapa:', chapa);
}

async function handleSubscriptionCancelled(subscription) {
  const chapa = subscription.metadata.chapa;

  if (!chapa) {
    console.error('❌ No chapa in subscription metadata');
    throw new Error('No chapa in subscription metadata');
  }

  console.log('📊 Cancelling subscription for chapa:', chapa);

  const { data, error } = await supabase.from('usuarios_premium').update({
    estado: 'cancelled',
    fecha_cancelacion: new Date().toISOString()
  }).eq('chapa', chapa);

  if (error) {
    console.error('❌ Error cancelling in Supabase:', error);
    throw error;
  }

  console.log('✅ Successfully cancelled subscription for chapa:', chapa);
}
