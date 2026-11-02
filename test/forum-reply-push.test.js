const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadHandler(rows, sentPush) {
  const originalLoad = Module._load;
  const db = {
    from(table) {
      const query = {
        select() { return this; },
        eq(column, value) { this.column = column; this.value = value; return this; },
        async maybeSingle() {
          return { data: rows[table]?.find(row => String(row[this.column]) === String(this.value)) || null, error: null };
        },
        async then(resolve) {
          return resolve({ data: (rows[table] || []).filter(row => String(row[this.column]) === String(this.value)), error: null });
        },
        async insert(value) {
          rows[table] ||= [];
          rows[table].push(value);
          return { error: null };
        },
        update() { return { eq: async () => ({ error: null }) }; },
        delete() { return { eq: async () => ({ error: null }) }; }
      };
      return query;
    }
  };
  Module._load = function (name, parent, isMain) {
    if (name === 'nodemailer') return { createTransport: () => ({ sendMail: async () => ({ accepted: ['user@example.com'] }) }) };
    if (name === '@supabase/supabase-js') return { createClient: () => db };
    if (name === 'web-push') return { setVapidDetails() {}, sendNotification: async (subscription, payload) => sentPush.push({ subscription, payload: JSON.parse(payload) }) };
    return originalLoad.call(this, name, parent, isMain);
  };
  delete require.cache[require.resolve('../lib/forum-reply-notification')];
  try { return require('../lib/forum-reply-notification'); }
  finally { Module._load = originalLoad; }
}

function response() {
  return {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('only a direct reply sends push to the original author, with a link to that reply', async () => {
  const sentPush = [];
  const rows = {
    mensajes_foro: [
      { id: 10, chapa: '816', texto: 'Original' },
      { id: 11, chapa: '795', texto: 'Respuesta', parent_message_id: 10, reply_to_chapa: '816' },
      { id: 12, chapa: '795', texto: 'General' },
      { id: 13, chapa: '816', texto: 'Mi respuesta', parent_message_id: 10, reply_to_chapa: '816' }
    ],
    usuarios: [{ chapa: '816', nombre: 'Usuario', activo: true }],
    push_subscriptions: [
      { user_chapa: '816', endpoint: 'https://push.example/816', p256dh: 'key', auth: 'auth' },
      { user_chapa: '795', endpoint: 'https://push.example/795', p256dh: 'key', auth: 'auth' }
    ]
  };
  const handler = loadHandler(rows, sentPush);
  for (const messageId of [12, 13, 11]) {
    const res = response();
    await handler({ method: 'POST', body: { messageId } }, res);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(sentPush.length, 1);
  assert.equal(sentPush[0].subscription.endpoint, 'https://push.example/816');
  assert.equal(sentPush[0].payload.url, '/?page=foro&message=11');
  assert.equal(sentPush[0].payload.type, 'forum');
});
