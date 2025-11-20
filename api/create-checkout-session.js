const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chapa, priceId } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId || 'price_1SVccrFApc6nOGEvgrJJ1xBR',
        quantity: 1,
      }],
      success_url: `https://tu-dominio.com/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://tu-dominio.com/cancel`,
      client_reference_id: chapa,
      metadata: { chapa }
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
