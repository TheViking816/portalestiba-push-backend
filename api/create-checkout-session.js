const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Manejar preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const allowedOrigin = 'https://portal-estiba-vlc.vercel.app';
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  const legacyMessage = `Si el pago falla, abre el portal desde el dominio oficial: ${allowedOrigin}/ (la version antigua ya no funciona).`;

  if (origin && origin !== allowedOrigin) {
    return res.status(400).json({
      error: legacyMessage
    });
  }

  if (referer && !referer.startsWith(allowedOrigin)) {
    return res.status(400).json({
      error: legacyMessage
    });
  }

  const { chapa, priceId } = req.body;

  if (!chapa) {
    return res.status(400).json({ error: 'Chapa es requerida' });
  }

  const allowedPriceIds = new Set([
    'price_1ShUsJFaw8romGYaKSImR29Z', // mensual
    'price_1Shc9sFaw8romGYaAdQia54L'  // anual
  ]);

  if (!priceId || !allowedPriceIds.has(priceId)) {
    console.warn('Invalid priceId received:', priceId);
    return res.status(400).json({ error: 'PriceId invalido' });
  }

  try {
    console.log('Creating checkout session for chapa:', chapa);

    const { data: usuario, error: usuarioError } = await supabase
      .from('usuarios_premium')
      .select('estado, periodo_fin, stripe_customer_id')
      .eq('chapa', chapa)
      .limit(1)
      .maybeSingle();

    if (usuarioError) {
      console.warn('⚠️ No se pudo consultar usuarios_premium:', usuarioError.message);
    } else if (usuario) {
      const estado = (usuario.estado || '').toLowerCase();
      const periodoFin = usuario.periodo_fin ? new Date(usuario.periodo_fin) : null;
      const vigente = estado === 'active' || estado === 'trialing';
      const noExpirado = !periodoFin || periodoFin > new Date();

      if (vigente && noExpirado) {
        if (!usuario.stripe_customer_id) {
          return res.status(409).json({
            error: 'Suscripción activa detectada pero sin cliente Stripe. Contacta soporte.'
          });
        }

        const portalSession = await stripe.billingPortal.sessions.create({
          customer: usuario.stripe_customer_id,
          return_url: `${process.env.FRONTEND_URL || 'https://portal-estiba-vlc.vercel.app/'}?portal=return`,
        });

        return res.status(200).json({
          url: portalSession.url,
          alreadyActive: true
        });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL || 'https://portal-estiba-vlc.vercel.app'}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://portal-estiba-vlc.vercel.app'}/?canceled=true`,
      client_reference_id: chapa,
      metadata: { chapa },
      subscription_data: {
        metadata: {
          chapa: chapa
        }
      }
    });

    console.log('Checkout session created:', session.id);
    return res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ error: error.message });
  }
};



