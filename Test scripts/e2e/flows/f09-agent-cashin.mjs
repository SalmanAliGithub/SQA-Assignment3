// F-9 — Agent onboarding → float top-up → cash-in to user wallet.
import { onboardAgent } from './blocks/b06-onboard-agent.mjs';
import { assertSmsReceived } from '../lib/side-effects.mjs';

export default {
  id: 'F-9',
  name: 'Agent onboarding + float top-up + cash-in',
  dependsOn: ['F-7', 'F-1', 'F-17'],
  actors: ['AD1', 'AG1', 'U1'],
  endpoints: [
    'POST /admin/agents', 'GET /admin/agents', 'GET /admin/agents/{id}',
    'POST /admin/agents/{id}/float-topup',
    'POST /admin/agents/{id}/suspend', 'POST /admin/agents/{id}/reactivate',
    'GET /cico/agents/nearby',
    'POST /cico/cash-in',
    'GET /me/agent', 'GET /me/agent/commission-rules', 'GET /me/agent/commissions', 'GET /me/agent/commissions/{entryId}',
    'GET /me/agent/transactions', 'GET /me/agent/transactions/{id}',
    'GET /me/wallet', 'GET /me/transactions/{id}',
  ],
  async run(ctx) {
    const { http, fixtures, assert } = ctx;

    ctx.currentActor = 'AD1';
    ctx.currentStep = 'onboard';
    await onboardAgent(ctx, { adminLabel: 'AD1', agentLabel: 'AG1', phone: fixtures.nextPhone('AG1') });

    ctx.currentStep = 'list-agents';
    await http.get('/admin/agents', { actor: 'AD1', expectStatus: 200 });
    ctx.currentStep = 'detail-agent';
    await http.get(`/admin/agents/${ctx.actors.AG1.agentId}`, { actor: 'AD1', expectStatus: 200 });

    ctx.currentStep = 'float-topup';
    await http.post(`/admin/agents/${ctx.actors.AG1.agentId}/float-topup`, { amount: '10000.00' }, { actor: 'AD1', expectStatus: [200, 201] });

    ctx.currentStep = 'agent-home';
    await http.get('/me/agent', { actor: 'AG1', expectStatus: 200 });
    ctx.currentStep = 'commission-rules';
    await http.get('/me/agent/commission-rules', { actor: 'AG1', expectStatus: 200 });

    ctx.currentStep = 'agents-nearby';
    await http.get('/cico/agents/nearby', { actor: 'U1', query: { lat: 9.03, lng: 38.74, radiusKm: 5 }, expectStatus: 200 });

    // Reset SMS cursor before cash-in so we can assert recipient SMS lands afterwards.
    ctx.sms.resetCursor(ctx.actors.U1.phone);

    ctx.currentStep = 'cash-in';
    const key = fixtures.uuid();
    const cashIn = await http.post('/cico/cash-in', { customerPhone: ctx.actors.U1.phone, amount: '200.00' }, {
      actor: 'AG1', idempotencyKey: key, expectStatus: [200, 201],
    });
    const txId = cashIn.body?.transactionId || cashIn.body?.id;
    assert.assert(txId, 'cash-in must return transactionId', cashIn.body);
    ctx.fixtures.cashInTxId = txId;
    ctx.fixtures.cashInTxIds = [txId];

    ctx.currentStep = 'cash-in-sms';
    await assertSmsReceived(ctx, ctx.actors.U1.phone, /(cash[-\s]?in|deposit|received|credited)/i);

    ctx.currentStep = 'cash-in-replay';
    const replay = await http.post('/cico/cash-in', { customerPhone: ctx.actors.U1.phone, amount: '200.00' }, {
      actor: 'AG1', idempotencyKey: key, expectStatus: [200, 201, 409],
    });
    assert.assert([200, 201, 409].includes(replay.status), 'cash-in idempotent replay must be 2xx or 409');

    // Two additional cash-ins so F-15 reject/withdraw branches can run on distinct tx ids.
    for (let i = 0; i < 2; i++) {
      ctx.currentStep = `cash-in-extra-${i + 1}`;
      const r = await http.post('/cico/cash-in', { customerPhone: ctx.actors.U1.phone, amount: '50.00' }, {
        actor: 'AG1', idempotencyKey: fixtures.uuid(), expectStatus: [200, 201],
      });
      const id = r.body?.transactionId || r.body?.id;
      assert.assert(id, 'extra cash-in must return id', r.body);
      ctx.fixtures.cashInTxIds.push(id);
    }

    ctx.currentStep = 'user-wallet';
    const w = await http.get('/me/wallet', { actor: 'U1', expectStatus: 200 });
    const bal = w.body?.availableBalance ?? w.body?.balance;
    assert.assert(bal, '/me/wallet must include a balance', w.body);
    ctx.currentStep = 'user-tx-detail';
    await http.get(`/me/transactions/${txId}`, { actor: 'U1', expectStatus: 200 });

    ctx.currentStep = 'agent-transactions';
    await http.get('/me/agent/transactions', { actor: 'AG1', query: { type: 'cash_in' }, expectStatus: 200 });
    ctx.currentStep = 'agent-tx-detail';
    await http.get(`/me/agent/transactions/${txId}`, { actor: 'AG1', expectStatus: 200 });

    ctx.currentStep = 'agent-commissions';
    const start = new Date(Date.now() - 30 * 86400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86400_000).toISOString();
    const c = await http.get('/me/agent/commissions', { actor: 'AG1', query: { from: start, to: tomorrow }, expectStatus: 200 });
    const breakdown = c.body?.breakdown || c.body?.entries || c.body?.items || [];
    assert.assert(breakdown.length > 0, 'cash-in must have produced at least one commission entry', c.body);
    const entryId = breakdown[0].entryId || breakdown[0].id || breakdown[0].txId;
    ctx.currentStep = 'commission-detail';
    await http.get(`/me/agent/commissions/${entryId}`, { actor: 'AG1', expectStatus: 200 });

    // Suspend → cash-in must be rejected.
    ctx.currentStep = 'suspend';
    await http.post(`/admin/agents/${ctx.actors.AG1.agentId}/suspend`, { reason: 'cooldown test' }, { actor: 'AD1', expectStatus: [200, 201, 204] });
    ctx.currentStep = 'suspend-effect';
    const blocked = await http.post('/cico/cash-in', { customerPhone: ctx.actors.U1.phone, amount: '10.00' }, {
      actor: 'AG1', expectStatus: [403, 409, 422],
    });
    assert.assert(![200, 201].includes(blocked.status), 'cash-in while suspended must not succeed', blocked.body);
    ctx.currentStep = 'reactivate';
    await http.post(`/admin/agents/${ctx.actors.AG1.agentId}/reactivate`, {}, { actor: 'AD1', expectStatus: [200, 201, 204] });
  },
};
