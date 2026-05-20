// F-12 — P2P transfer + lookup + idempotency.
import { registerUser } from './blocks/b01-register-user.mjs';
import { assertSmsReceived, assertNotificationContains } from '../lib/side-effects.mjs';

export default {
  id: 'F-12',
  name: 'P2P transfer + lookup + idempotency',
  dependsOn: ['F-9'],
  actors: ['U1', 'U2'],
  endpoints: [
    'GET /users/lookup', 'POST /transfers',
    'GET /transfers/by-key/{idempotencyKey}',
    'GET /me/wallet', 'GET /me/transactions', 'GET /me/transactions/{id}',
    'GET /me/notifications', 'GET /me/notifications/{id}',
  ],
  async run(ctx) {
    const { http, fixtures, assert, sms } = ctx;

    ctx.currentStep = 'register-u2';
    const phone2 = fixtures.nextPhone('U2');
    await registerUser(ctx, { label: 'U2', phone: phone2, firstName: 'Abel', lastName: 'Kebede' });

    ctx.currentStep = 'lookup';
    const lookup = await http.get('/users/lookup', { actor: 'U1', query: { phone: phone2 }, expectStatus: 200 });
    assert.assert(lookup.body, 'lookup should return body');

    // Reset SMS cursor for U2 so we can assert the recipient-SMS arrives after the transfer.
    sms.resetCursor(phone2);

    ctx.currentStep = 'transfer';
    const key = fixtures.uuid();
    const t = await http.post('/transfers', { recipientPhone: phone2, amount: '50.00', note: 'snack' }, {
      actor: 'U1', idempotencyKey: key, expectStatus: [200, 201, 202],
    });
    const txId = t.body?.transactionId || t.body?.id;
    assert.assert(txId, 'transfer must return transactionId', t.body);
    ctx.fixtures.p2pTxId = txId;
    ctx.fixtures.p2pIdempotencyKey = key;

    ctx.currentStep = 'by-key';
    await http.get(`/transfers/by-key/${key}`, { actor: 'U1', expectStatus: 200 });

    ctx.currentStep = 'replay-same';
    const rep = await http.post('/transfers', { recipientPhone: phone2, amount: '50.00', note: 'snack' }, {
      actor: 'U1', idempotencyKey: key, expectStatus: [200, 201, 202],
    });
    assert.assert([200, 201, 202].includes(rep.status), 'idempotent replay must return 2xx', rep.body);

    ctx.currentStep = 'replay-conflict';
    const conf = await http.post('/transfers', { recipientPhone: phone2, amount: '99.00' }, {
      actor: 'U1', idempotencyKey: key, expectStatus: [409, 422],
    });
    assert.assert([409, 422].includes(conf.status), 'replay with conflicting body must 409/422', conf.body);

    ctx.currentStep = 'wallet-after';
    await http.get('/me/wallet', { actor: 'U1', expectStatus: 200 });
    ctx.currentStep = 'tx-list';
    await http.get('/me/transactions', { actor: 'U1', query: { limit: 10 }, expectStatus: 200 });
    ctx.currentStep = 'tx-detail';
    await http.get(`/me/transactions/${txId}`, { actor: 'U1', expectStatus: 200 });

    // Side-effect: recipient gets SMS + in-app notification referencing this txId.
    ctx.currentStep = 'transfer-sms';
    await assertSmsReceived(ctx, phone2, /(received|transfer|deposit|credited)/i);

    ctx.currentStep = 'transfer-notification';
    const notif = await assertNotificationContains(ctx, 'U2', n => {
      const md = n.metadata || {};
      const vars = md.variables || {};
      return (
        vars.transactionId === txId ||
        md.transactionId === txId ||
        n.transactionId === txId ||
        (typeof n.body === 'string' && n.body.includes(txId))
      );
    });
    ctx.fixtures.notificationId = notif.notificationId || notif.id;

    ctx.currentStep = 'notif-detail';
    await http.get(`/me/notifications/${ctx.fixtures.notificationId}`, { actor: 'U2', expectStatus: 200 });
  },
};
