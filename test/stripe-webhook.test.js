const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function mockExternalModules(request, parent, isMain) {
  if (request === 'stripe') return () => ({});
  if (request === '@supabase/supabase-js') return { createClient: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};

const webhook = require('../api/stripe-webhook');
const { escapeStripeSearchValue, oldestAccessSubscription } = webhook._test;
Module._load = originalLoad;

test('elige la suscripcion activa mas antigua al cancelar un duplicado', () => {
  const result = oldestAccessSubscription([
    { id: 'sub_new', status: 'active', created: 20 },
    { id: 'sub_canceled', status: 'canceled', created: 1 },
    { id: 'sub_old', status: 'active', created: 10 }
  ]);

  assert.equal(result.id, 'sub_old');
});

test('no conserva suscripciones que ya no dan acceso', () => {
  assert.equal(oldestAccessSubscription([
    { id: 'sub_past_due', status: 'past_due', created: 1 },
    { id: 'sub_canceled', status: 'canceled', created: 2 }
  ]), null);
});

test('escapa los valores de busqueda de Stripe', () => {
  assert.equal(escapeStripeSearchValue("o'hara\\test"), "o\\'hara\\\\test");
});
