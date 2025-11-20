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

  const { chapa, priceId } = req.body;

  if (!chapa) {
    return res.status(400).json({ error: 'Chapa es requerida' });
  }

  try {
    console.log('Creating checkout session for chapa:', chapa);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId || process.env.STRIPE_PRICE_ID_MENSUAL || 'price_1SVccrFApc6nOGEvgrJJ1xBR',
        quantity: 1,
      }],
      success_url: `${process.env.VITE_APP_URL || 'https://portalestibavlc.com'}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VITE_APP_URL || 'https://portalestibavlc.com'}/?canceled=true`,
      client_reference_id: chapa,
      metadata: { chapa }
    });

    console.log('Checkout session created:', session.id);
    return res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ error: error.message });
  }
};
