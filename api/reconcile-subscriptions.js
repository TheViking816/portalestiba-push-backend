/**
 * Endpoint admin para reconciliar suscripciones desde Stripe
 * POST /api/reconcile-subscriptions
 * Requiere header: Authorization: Bearer <ADMIN_SECRET>
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: usuarios, error } = await supabase
      .from('usuarios_premium')
      .select('chapa, stripe_subscription_id')
      .not('stripe_subscription_id', 'is', null);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const resultados = [];

    for (const user of usuarios || []) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripe_subscription_id
        );

        await supabase.rpc('actualizar_suscripcion_desde_webhook', {
          p_chapa: user.chapa,
          p_stripe_customer_id: subscription.customer,
          p_stripe_subscription_id: subscription.id,
          p_stripe_price_id: subscription.items.data[0].price.id,
          p_estado: subscription.status,
          p_periodo_inicio: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          p_periodo_fin: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
        });

        resultados.push({ chapa: user.chapa, ok: true });
      } catch (err) {
        resultados.push({ chapa: user.chapa, ok: false, error: err.message });
      }
    }

    return res.status(200).json({
      total: resultados.length,
      ok: resultados.filter((r) => r.ok).length,
      failed: resultados.filter((r) => !r.ok).length,
      resultados,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
