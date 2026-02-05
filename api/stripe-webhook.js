/**
 * Endpoint para recibir webhooks de Stripe
 * POST /api/stripe-webhook
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// En Vercel, necesitamos el body crudo para verificar la firma de Stripe
// y desactivar el bodyParser automático.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// Cliente de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getRawBody(req) {
  if (req.body && Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (req.body && typeof req.body === 'string') {
    return Buffer.from(req.body);
  }
  if (req.body && typeof req.body === 'object') {
    // Ya parseado: la firma puede fallar, pero intentamos
    return Buffer.from(JSON.stringify(req.body));
  }
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verificar la firma del webhook
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('📥 Webhook event received:', event.type);

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

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
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

  // Obtener la suscripción
  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  await updateUserPremium(chapa, subscription);
}

/**
 * Maneja actualizaciones de suscripción
 */
async function handleSubscriptionUpdate(subscription) {
  console.log('Subscription updated:', subscription.id);

  // Refrescar la suscripcion para tener periodos correctos
  const freshSubscription = await stripe.subscriptions.retrieve(subscription.id);
  const chapa = await resolveChapa(freshSubscription);

  if (!chapa) {
    console.error('No chapa found in subscription metadata');
    return;
  }

  await updateUserPremium(chapa, freshSubscription);
}

/**
 * Maneja cancelación de suscripción
 */
async function handleSubscriptionCanceled(subscription) {
  console.log('Subscription canceled:', subscription.id);

  const freshSubscription = await stripe.subscriptions.retrieve(subscription.id);
  const chapa = await resolveChapa(freshSubscription);

  if (!chapa) {
    console.error('No chapa found in subscription metadata');
    return;
  }

  await supabase.rpc('actualizar_suscripcion_desde_webhook', {
    p_chapa: chapa,
    p_stripe_customer_id: freshSubscription.customer,
    p_stripe_subscription_id: freshSubscription.id,
    p_stripe_price_id: freshSubscription.items.data[0].price.id,
    p_estado: 'canceled',
    p_periodo_inicio: new Date(freshSubscription.current_period_start * 1000).toISOString(),
    p_periodo_fin: new Date(freshSubscription.current_period_end * 1000).toISOString(),
  });

  console.log('Usuario premium actualizado (cancelado):', chapa);
}

/**
 * Maneja pago exitoso de factura
 */
async function handleInvoicePaymentSucceeded(invoice) {
  console.log('💰 Invoice payment succeeded:', invoice.id);

  if (!invoice.subscription) return;

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const chapa = await resolveChapa(subscription);

  if (!chapa) return;

  await updateUserPremium(chapa, subscription);
}

/**
 * Maneja fallo de pago de factura
 */
async function handleInvoicePaymentFailed(invoice) {
  console.log('❌ Invoice payment failed:', invoice.id);

  if (!invoice.subscription) return;

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const chapa = await resolveChapa(subscription);

  if (!chapa) return;

  // Actualizar estado a 'past_due'
  await supabase.rpc('actualizar_suscripcion_desde_webhook', {
    p_chapa: chapa,
    p_stripe_customer_id: subscription.customer,
    p_stripe_subscription_id: subscription.id,
    p_stripe_price_id: subscription.items.data[0].price.id,
    p_estado: 'past_due',
    p_periodo_inicio: new Date(subscription.current_period_start * 1000).toISOString(),
    p_periodo_fin: new Date(subscription.current_period_end * 1000).toISOString(),
  });

  console.log('⚠️ Usuario premium actualizado (past_due):', chapa);
}

/**
 * Resuelve chapa usando metadata o registro previo en usuarios_premium
 */
async function resolveChapa(subscription) {
  const metaChapa = subscription.metadata?.chapa;
  if (metaChapa) return metaChapa;

  try {
    const bySub = await supabase
      .from('usuarios_premium')
      .select('chapa')
      .eq('stripe_subscription_id', subscription.id)
      .limit(1)
      .maybeSingle();

    if (bySub?.data?.chapa) return bySub.data.chapa;

    if (subscription.customer) {
      const byCustomer = await supabase
        .from('usuarios_premium')
        .select('chapa')
        .eq('stripe_customer_id', subscription.customer)
        .limit(1)
        .maybeSingle();

      if (byCustomer?.data?.chapa) return byCustomer.data.chapa;
    }
  } catch (err) {
    console.error('Error resolving chapa:', err.message);
  }

  return null;
}

/**
 * Actualiza el usuario premium en Supabase
 */
async function updateUserPremium(chapa, subscription) {
  const estado = subscription.status; // 'active', 'trialing', 'past_due', 'canceled'

  const { data, error } = await supabase.rpc('actualizar_suscripcion_desde_webhook', {
    p_chapa: chapa,
    p_stripe_customer_id: subscription.customer,
    p_stripe_subscription_id: subscription.id,
    p_stripe_price_id: subscription.items.data[0].price.id,
    p_estado: estado,
    p_periodo_inicio: new Date(subscription.current_period_start * 1000).toISOString(),
    p_periodo_fin: new Date(subscription.current_period_end * 1000).toISOString(),
  });

  if (error) {
    console.error('❌ Error updating user in Supabase:', error);
    throw error;
  }

  console.log('✅ Usuario premium actualizado en Supabase:', chapa);
}
