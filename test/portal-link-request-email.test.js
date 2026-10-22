const test = require('node:test');
const assert = require('node:assert/strict');
const { portalLinkRequestEmail } = require('../lib/portal-link-request-email');
test('portal link notification contains only the requested account and fixed admin recipient', () => {
  const message = portalLinkRequestEmail({kind:'admin_portal_links_requested',recipient:'portalestibavlc@gmail.com',chapa:'72683',password:'NOT-FOR-EMAIL'});
  assert.equal(message.to,'portalestibavlc@gmail.com');
  assert.match(message.subject,/72683/);assert.match(message.html,/manualmente/);
  assert.equal(JSON.stringify(message).includes('NOT-FOR-EMAIL'),false);
  assert.equal(portalLinkRequestEmail({kind:'user_activated'}),null);
  assert.throws(()=>portalLinkRequestEmail({kind:'admin_portal_links_requested',recipient:'other@example.com',chapa:'72683'}));
});
