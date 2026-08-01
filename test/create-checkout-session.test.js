const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

let premiumResult = { data: null, error: null };
let subscriptionResult = { data: [] };
let openSessionResult = { data: [] };
let checkoutCreateCalls = 0;

const fakeStripe = {
  subscriptions: {
    list: async () => subscriptionResult
  },
  checkout: {
    sessions: {
      list: async () => openSessionResult,
      create: async params => {
        checkoutCreateCalls += 1;
        return { id: 'cs_test', url: 'https://checkout.stripe.test/session', ...params };
      }
    }
  },
  billingPortal: {
    sessions: {
      create: async () => ({ url: 'https://billing.stripe.test/portal' })
    }
  },
  customers: {
    search: async () => ({ data: [] }),
    create: async () => ({ id: 'cus_test' })
  }
};

function createQuery(result) {
  return {
    select() { return this; },
    eq() { return this; },
    limit() { return this; },
    maybeSingle: async () => result
  };
}

const fakeSupabase = {
  from(table) {
    if (table === 'usuarios_premium') return createQuery(premiumResult);
    return createQuery({ data: { email: 'test@example.com', nombre: 'Test' }, error: null });
  }
};

const originalLoad = Module._load;
Module._load = function mockExternalModules(request, parent, isMain) {
  if (request === 'stripe') {
    return () => fakeStripe;
  }
  if (request === '@supabase/supabase-js') {
    return { createClient: () => fakeSupabase };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const checkoutHandler = require('../api/create-checkout-session');
const { normalizeChapa, hasBlockingSubscription } = checkoutHandler._test;
Module._load = originalLoad;

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

function createRequest() {
  return {
    method: 'POST',
    headers: { origin: 'https://portal-estiba-vlc.vercel.app' },
    body: { chapa: '735', priceId: 'price_1Shc9sFaw8romGYaAdQia54L' }
  };
}

test('normaliza chapas validas y rechaza entradas manipuladas', () => {
  assert.equal(normalizeChapa(' 735 '), '735');
  assert.equal(normalizeChapa(735), '735');
  assert.equal(normalizeChapa(''), null);
  assert.equal(normalizeChapa('735x'), null);
});

test('bloquea cualquier suscripcion que todavia pueda cobrar o completarse', () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) {
    assert.equal(hasBlockingSubscription([{ status }]), true, status);
  }
});

test('permite un alta nueva solo cuando todas las suscripciones terminaron', () => {
  assert.equal(hasBlockingSubscription([{ status: 'canceled' }]), false);
  assert.equal(hasBlockingSubscription([{ status: 'incomplete_expired' }]), false);
  assert.equal(hasBlockingSubscription([]), false);
});

test('una suscripcion existente abre el portal y nunca crea otro checkout', async () => {
  premiumResult = {
    data: { estado: 'active', periodo_fin: '2027-04-13T13:16:18Z', stripe_customer_id: 'cus_existing' },
    error: null
  };
  subscriptionResult = { data: [{ id: 'sub_existing', status: 'active' }] };
  openSessionResult = { data: [] };
  checkoutCreateCalls = 0;

  const res = createResponse();
  await checkoutHandler(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.alreadyActive, true);
  assert.equal(res.body.url, 'https://billing.stripe.test/portal');
  assert.equal(checkoutCreateCalls, 0);
});

test('si Supabase falla, el checkout falla cerrado y no duplica', async () => {
  premiumResult = { data: null, error: { message: 'timeout' } };
  subscriptionResult = { data: [] };
  checkoutCreateCalls = 0;

  const res = createResponse();
  await checkoutHandler(createRequest(), res);

  assert.equal(res.statusCode, 503);
  assert.equal(checkoutCreateCalls, 0);
});

test('una suscripcion terminada permite checkout reutilizando el cliente', async () => {
  premiumResult = {
    data: { estado: 'canceled', periodo_fin: '2026-01-01T00:00:00Z', stripe_customer_id: 'cus_existing' },
    error: null
  };
  subscriptionResult = { data: [{ id: 'sub_old', status: 'canceled' }] };
  openSessionResult = { data: [] };
  checkoutCreateCalls = 0;

  const res = createResponse();
  await checkoutHandler(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.url, 'https://checkout.stripe.test/session');
  assert.equal(checkoutCreateCalls, 1);
});
