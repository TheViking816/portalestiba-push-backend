const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

  if (origin && origin !== allowedOrigin) {
    return res.status(400).json({
      error: `Dominio no permitido. Usa ${allowedOrigin}/`
    });
  }

  if (referer && !referer.startsWith(allowedOrigin)) {
    return res.status(400).json({
      error: `Dominio no permitido. Usa ${allowedOrigin}/`
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



