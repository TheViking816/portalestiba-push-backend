/**
 * Endpoint para recibir webhooks de Stripe
 * POST /api/stripe-webhook
 *
 * IMPORTANTE: Este endpoint necesita raw body para verificar la firma de Stripe
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Cliente de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configuración especial de Vercel para recibir raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Leer el raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);

    console.log('📥 Webhook received');
    console.log('🔑 Signature present:', !!sig);
    console.log('📦 Body size:', body.length);
    console.log('🔐 Webhook secret configured:', !!webhookSecret);

    if (!sig) {
      console.error('❌ No signature header found');
      return res.status(400).send('No signature header');
    }

    if (!webhookSecret) {
      console.error('❌ STRIPE_WEBHOOK_SECRET not configured');
      return res.status(500).send('Webhook secret not configured');
    }

    // Verificar la firma del webhook
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      webhookSecret
    );

    console.log('✅ Signature verified, event type:', event.type);

  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('❌ Error type:', err.type);
    console.error('❌ Full error:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('📥 Processing webhook event:', event.type);

  try {
    // Procesar diferentes tipos de eventos
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCanceled(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handleInvoicePaymentSucceeded(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handleInvoicePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    console.log('✅ Webhook processed successfully');
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Maneja cuando se completa un checkout
 */
async function handleCheckoutCompleted(session) {
  console.log('✅ Checkout completed:', session.id);

  const chapa = session.client_reference_id || session.metadata?.chapa;

  if (!chapa) {
    console.error('❌ No chapa found in session');
    return;
  }

  console.log('📋 Processing checkout for chapa:', chapa);

  // Obtener la suscripción
  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  await updateUserPremium(chapa, subscription);
}

/**
 * Maneja actualizaciones de suscripción
 */
async function handleSubscriptionUpdate(subscription) {
  console.log('🔄 Subscription updated:', subscription.id);

  const chapa = subscription.metadata?.chapa;

  if (!chapa) {
    console.error('❌ No chapa found in subscription metadata');
    return;
  }

  console.log('📋 Updating subscription for chapa:', chapa);

  await updateUserPremium(chapa, subscription);
}

/**
 * Maneja cancelación de suscripción
 */
async function handleSubscriptionCanceled(subscription) {
  console.log('❌ Subscription canceled:', subscription.id);

  const chapa = subscription.metadata?.chapa;

  if (!chapa) {
    console.error('❌ No chapa found in subscription metadata');
    return;
  }

  console.log('📋 Canceling subscription for chapa:', chapa);

  const { data, error } = await supabase.rpc('actualizar_suscripcion_desde_webhook', {
    p_chapa: chapa,
    p_stripe_customer_id: subscription.customer,
    p_stripe_subscription_id: subscription.id,
    p_stripe_price_id: subscription.items.data[0].price.id,
    p_estado: 'canceled',
    p_periodo_inicio: new Date(subscription.current_period_start * 1000).toISOString(),
    p_periodo_fin: new Date(subscription.current_period_end * 1000).toISOString(),
  });

  if (error) {
    console.error('❌ Error updating Supabase:', error);
    throw error;
  }

  console.log('✅ Usuario premium actualizado (cancelado):', chapa);
}

/**
 * Maneja pago exitoso de factura
 */
async function handleInvoicePaymentSucceeded(invoice) {
  console.log('💰 Invoice payment succeeded:', invoice.id);

  if (!invoice.subscription) {
    console.log('ℹ️ Invoice has no subscription, skipping');
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const chapa = subscription.metadata?.chapa;

  if (!chapa) {
    console.error('❌ No chapa found in subscription metadata');
    return;
  }

  console.log('📋 Processing invoice payment for chapa:', chapa);

  await updateUserPremium(chapa, subscription);
}

/**
 * Maneja fallo de pago de factura
 */
async function handleInvoicePaymentFailed(invoice) {
  console.log('❌ Invoice payment failed:', invoice.id);

  if (!invoice.subscription) {
    console.log('ℹ️ Invoice has no subscription, skipping');
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const chapa = subscription.metadata?.chapa;

  if (!chapa) {
    console.error('❌ No chapa found in subscription metadata');
    return;
  }

  console.log('📋 Marking subscription as past_due for chapa:', chapa);

  // Actualizar estado a 'past_due'
  const { data, error } = await supabase.rpc('actualizar_suscripcion_desde_webhook', {
    p_chapa: chapa,
    p_stripe_customer_id: subscription.customer,
    p_stripe_subscription_id: subscription.id,
    p_stripe_price_id: subscription.items.data[0].price.id,
    p_estado: 'past_due',
    p_periodo_inicio: new Date(subscription.current_period_start * 1000).toISOString(),
    p_periodo_fin: new Date(subscription.current_period_end * 1000).toISOString(),
  });

  if (error) {
    console.error('❌ Error updating Supabase:', error);
    throw error;
  }

  console.log('⚠️ Usuario premium actualizado (past_due):', chapa);
}

/**
 * Actualiza el usuario premium en Supabase
 */
async function updateUserPremium(chapa, subscription) {
  const estado = subscription.status; // 'active', 'trialing', 'past_due', 'canceled'

  // Validar y convertir fechas
  let periodo_inicio, periodo_fin;

  try {
    if (subscription.current_period_start) {
      periodo_inicio = new Date(subscription.current_period_start * 1000).toISOString();
    } else {
      periodo_inicio = new Date().toISOString();
      console.warn('⚠️ No current_period_start, usando NOW()');
    }
  } catch (err) {
    console.error('❌ Error parsing periodo_inicio:', err);
    periodo_inicio = new Date().toISOString();
  }

  try {
    if (subscription.current_period_end) {
      periodo_fin = new Date(subscription.current_period_end * 1000).toISOString();
    } else {
      // Si no hay fecha fin, poner 1 mes desde ahora
      const oneMonthFromNow = new Date();
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
      periodo_fin = oneMonthFromNow.toISOString();
      console.warn('⚠️ No current_period_end, usando NOW() + 1 mes');
    }
  } catch (err) {
    console.error('❌ Error parsing periodo_fin:', err);
    const oneMonthFromNow = new Date();
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    periodo_fin = oneMonthFromNow.toISOString();
  }

  console.log('💾 Updating user in Supabase:', {
    chapa,
    estado,
    subscription_id: subscription.id,
    periodo_inicio,
    periodo_fin,
  });

  const { data, error } = await supabase.rpc('actualizar_suscripcion_desde_webhook', {
    p_chapa: chapa,
    p_stripe_customer_id: subscription.customer,
    p_stripe_subscription_id: subscription.id,
    p_stripe_price_id: subscription.items.data[0].price.id,
    p_estado: estado,
    p_periodo_inicio: periodo_inicio,
    p_periodo_fin: periodo_fin,
  });

  if (error) {
    console.error('❌ Error updating user in Supabase:', error);
    throw error;
  }

  console.log('✅ Usuario premium actualizado en Supabase:', chapa);
}
