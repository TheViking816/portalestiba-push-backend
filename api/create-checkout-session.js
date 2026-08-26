const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OFFICIAL_ORIGIN = 'https://portal-estiba-vlc.vercel.app';
const ALLOWED_PRICE_IDS = new Set([
  'price_1ShUsJFaw8romGYaKSImR29Z', // mensual
  'price_1Shc9sFaw8romGYaAdQia54L'  // anual
]);
const BLOCKING_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused'
]);

function normalizeChapa(value) {
  const chapa = String(value ?? '').trim();
  return /^\d{2,4}$/.test(chapa) ? chapa : null;
}

function hasBlockingSubscription(subscriptions) {
  return subscriptions.some(subscription =>
    BLOCKING_SUBSCRIPTION_STATUSES.has(subscription.status)
  );
}

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || OFFICIAL_ORIGIN).replace(/\/+$/, '');
}

function escapeStripeSearchValue(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function createPortalResponse(res, customerId, reason) {
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getFrontendUrl()}/?portal=return`
  });

  return res.status(200).json({
    url: portalSession.url,
    alreadyActive: true,
    reason
  });
}

async function findExistingCustomers(chapa, email) {
  const searches = [
    stripe.customers.search({
      query: `metadata['chapa']:'${escapeStripeSearchValue(chapa)}'`,
      limit: 100
    })
  ];

  if (email) {
    searches.push(stripe.customers.search({
      query: `email:'${escapeStripeSearchValue(email.toLowerCase())}'`,
      limit: 100
    }));
  }

  const results = await Promise.all(searches);
  const customersById = new Map();

  for (const result of results) {
    for (const customer of result.data) {
      if (!customer.deleted) customersById.set(customer.id, customer);
    }
  }

  return [...customersById.values()];
}

async function findBlockingCustomer(customerIds) {
  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100
    });

    if (hasBlockingSubscription(subscriptions.data)) return customerId;
  }

  return null;
}

async function createCustomer(chapa, usuario) {
  const customerParams = {
    metadata: { chapa }
  };

  if (usuario?.email) customerParams.email = usuario.email;
  if (usuario?.nombre) customerParams.name = usuario.nombre;

  return stripe.customers.create(
    customerParams,
    { idempotencyKey: `portal-estiba-customer-${chapa}` }
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', OFFICIAL_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const legacyMessage = `Abre el portal desde el dominio oficial: ${OFFICIAL_ORIGIN}/`;

  if (origin && origin !== OFFICIAL_ORIGIN) {
    return res.status(400).json({ error: legacyMessage });
  }

  if (referer && !referer.startsWith(OFFICIAL_ORIGIN)) {
    return res.status(400).json({ error: legacyMessage });
  }

  const chapa = normalizeChapa(req.body?.chapa);
  const priceId = req.body?.priceId;

  if (!chapa) {
    return res.status(400).json({ error: 'Chapa invalida' });
  }

  if (!priceId || !ALLOWED_PRICE_IDS.has(priceId)) {
    console.warn('Invalid priceId received:', priceId);
    return res.status(400).json({ error: 'PriceId invalido' });
  }

  try {
    console.log('Checking checkout eligibility for chapa:', chapa);

    const { data: premiumUser, error: premiumError } = await supabase
      .from('usuarios_premium')
      .select('estado, periodo_fin, stripe_customer_id')
      .eq('chapa', chapa)
      .limit(1)
      .maybeSingle();

    // Fail closed: si no podemos comprobar el estado, no creamos otra suscripcion.
    if (premiumError) {
      console.error('No se pudo consultar usuarios_premium:', premiumError.message);
      return res.status(503).json({
        error: 'No se ha podido verificar tu suscripcion. Intentalo de nuevo en unos minutos.'
      });
    }

    const { data: usuario, error: usuarioError } = await supabase
      .from('usuarios')
      .select('email, nombre')
      .eq('chapa', chapa)
      .limit(1)
      .maybeSingle();

    if (usuarioError) {
      console.error('No se pudo consultar usuarios:', usuarioError.message);
      return res.status(503).json({
        error: 'No se ha podido verificar tu cuenta. Intentalo de nuevo en unos minutos.'
      });
    }

    const existingCustomers = await findExistingCustomers(chapa, usuario?.email);
    const customerIds = new Set(existingCustomers.map(customer => customer.id));
    if (premiumUser?.stripe_customer_id) customerIds.add(premiumUser.stripe_customer_id);

    const blockingCustomerId = await findBlockingCustomer(customerIds);
    if (blockingCustomerId) {
      return createPortalResponse(res, blockingCustomerId, 'subscription_exists');
    }

    let customerId = premiumUser?.stripe_customer_id
      || existingCustomers[0]?.id
      || null;

    if (customerId) {
      const estado = String(premiumUser?.estado || '').toLowerCase();
      const periodoFin = premiumUser?.periodo_fin
        ? new Date(premiumUser.periodo_fin)
        : null;
      const premiumVigente = ['active', 'trialing'].includes(estado)
        && (!periodoFin || periodoFin > new Date());

      if (premiumVigente) {
        return createPortalResponse(res, customerId, 'database_subscription_active');
      }
    } else if (premiumUser && ['active', 'trialing'].includes(String(premiumUser.estado || '').toLowerCase())) {
      return res.status(409).json({
        error: 'Hay una suscripcion activa sin cliente Stripe asociado. Contacta con soporte.'
      });
    }

    if (!customerId) {
      const customer = await createCustomer(chapa, usuario);
      customerId = customer.id;
    }

    // Segunda comprobacion para clientes recuperados por metadata o recien creados.
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100
    });

    if (hasBlockingSubscription(subscriptions.data)) {
      return createPortalResponse(res, customerId, 'subscription_exists');
    }

    // Reutilizar una sesion abierta evita que varios clics creen checkouts paralelos.
    const openSessions = await stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 1
    });

    if (openSessions.data[0]?.url) {
      return res.status(200).json({
        url: openSessions.data[0].url,
        checkoutPending: true
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${getFrontendUrl()}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getFrontendUrl()}/pricing.html?canceled=true`,
      client_reference_id: chapa,
      metadata: { chapa },
      subscription_data: { metadata: { chapa } }
    });

    console.log('Checkout session created:', session.id, 'for customer:', customerId);
    return res.status(200).json({
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({
      error: 'No se ha podido iniciar el pago. Intentalo de nuevo o contacta con soporte.'
    });
  }
};

module.exports._test = {
  normalizeChapa,
  hasBlockingSubscription,
  escapeStripeSearchValue
};
