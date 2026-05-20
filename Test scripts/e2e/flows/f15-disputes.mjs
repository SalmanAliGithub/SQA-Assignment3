// F-15 — Dispute lifecycle (user → agent response → admin resolution).
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-15',
  name: 'Dispute lifecycle',
  dependsOn: ['F-9'],
  actors: ['U1', 'AG1', 'AD1'],
  endpoints: [
    'POST /disputes', 'GET /disputes/{id}',
    'POST /disputes/{id}/attachments', 'GET /disputes/{id}/attachments',
    'POST /disputes/{id}/comments', 'GET /disputes/{id}/comments',
    'POST /disputes/{id}/withdraw', 'POST /disputes/{id}/response',
    'GET /me/agent/disputes', 'GET /me/agent/disputes/open-count',
    'GET /me/agent/disputes/{id}',
    'POST /me/agent/disputes/{id}/response', 'POST /me/agent/disputes/{id}/comments',
    'GET /admin/disputes', 'POST /admin/disputes/{id}/pickup',
    'POST /admin/disputes/{id}/request-info', 'POST /admin/disputes/{id}/resolve',
    'POST /admin/disputes/{id}/reject',
  ],
  async run(ctx) {
    const { http, fixtures, assert } = ctx;
    const txIds = ctx.fixtures.cashInTxIds || (ctx.fixtures.cashInTxId ? [ctx.fixtures.cashInTxId] : []);
    assert.assert(txIds.length >= 3, 'F-9 must seed at least 3 cash-in tx ids for F-15 branches', txIds);
    const [txId, txIdReject, txIdWithdraw] = txIds;

    ctx.currentStep = 'create';
    const d = await http.post('/disputes', {
      transactionId: txId, category: 'WRONG_AMOUNT',
      description: 'got 150 but charged 200',
    }, { actor: 'U1', allowStatus: [200, 201, 422] });
    const disputeId = d.body?.id;
    if (!disputeId) { ctx.log.warn('dispute not created'); return; }

    ctx.currentStep = 'detail';
    await http.get(`/disputes/${disputeId}`, { actor: 'U1', expectStatus: 200 });

    ctx.currentStep = 'attach';
    const fd = new FormData();
    fd.append('file', new Blob([fixtures.tinyPng()], { type: 'image/png' }), 'evidence.png');
    await http.request({ method: 'POST', path: `/disputes/${disputeId}/attachments`, multipart: fd, actor: 'U1', allowStatus: [200, 201, 422] });
    ctx.currentStep = 'list-attach';
    await http.get(`/disputes/${disputeId}/attachments`, { actor: 'U1', allowStatus: [200, 404] });

    ctx.currentStep = 'comment';
    await http.post(`/disputes/${disputeId}/comments`, { comment: 'agent miscounted' }, { actor: 'U1', allowStatus: [200, 201, 422] });
    ctx.currentStep = 'list-comments';
    await http.get(`/disputes/${disputeId}/comments`, { actor: 'U1', allowStatus: [200, 404] });

    ctx.currentStep = 'agent-open-count';
    await http.get('/me/agent/disputes/open-count', { actor: 'AG1', expectStatus: 200 });
    ctx.currentStep = 'agent-list';
    await http.get('/me/agent/disputes', { actor: 'AG1', expectStatus: 200 });
    ctx.currentStep = 'agent-detail';
    await http.get(`/me/agent/disputes/${disputeId}`, { actor: 'AG1', allowStatus: [200, 404] });

    ctx.currentStep = 'agent-response';
    await http.post(`/me/agent/disputes/${disputeId}/response`, { response: 'I counted twice, customer signed receipt' }, { actor: 'AG1', idempotencyKey: fixtures.uuid(), allowStatus: [200, 201, 422] });
    ctx.currentStep = 'agent-comment';
    await http.post(`/me/agent/disputes/${disputeId}/comments`, { comment: 'see receipt' }, { actor: 'AG1', allowStatus: [200, 201, 422] });

    // deprecated route
    ctx.currentStep = 'deprecated-response';
    await http.post(`/disputes/${disputeId}/response`, { response: 'deprecated route' }, { actor: 'AG1', allowStatus: [200, 201, 308, 409, 410, 422] });

    ctx.currentStep = 'admin-list';
    await http.get('/admin/disputes', { actor: 'AD1', query: { status: 'AWAITING_ADMIN' }, expectStatus: 200 });

    ctx.currentStep = 'pickup';
    await http.post(`/admin/disputes/${disputeId}/pickup`, {}, { actor: 'AD1', allowStatus: [200, 201, 204, 409] });

    ctx.currentStep = 'request-info';
    await http.post(`/admin/disputes/${disputeId}/request-info`, { from: 'agent', message: 'upload receipt please' }, { actor: 'AD1', allowStatus: [200, 201, 204, 422] });

    ctx.currentStep = 'resolve';
    await http.post(`/admin/disputes/${disputeId}/resolve`, { reason: 'agent at fault per evidence', reversalAmount: '50.00' }, { actor: 'AD1', allowStatus: [200, 201, 204, 409, 422] });

    // Reject branch — uses a distinct cash-in tx so the dispute is unique.
    ctx.currentStep = 'create-reject';
    const d2 = await http.post('/disputes', {
      transactionId: txIdReject, category: 'WRONG_AMOUNT', description: 'reject-test',
    }, { actor: 'U1', expectStatus: [200, 201] });
    const id2 = d2.body?.id;
    assert.assert(id2, 'second dispute must return id', d2.body);
    // Admin must pick up the dispute (→ INVESTIGATING) before reject is valid.
    ctx.currentStep = 'admin-pickup-2';
    await http.post(`/admin/disputes/${id2}/pickup`, {}, { actor: 'AD1', expectStatus: [200, 201, 204] });
    ctx.currentStep = 'admin-reject';
    await http.post(`/admin/disputes/${id2}/reject`, { reason: 'no evidence supplied' }, { actor: 'AD1', expectStatus: [200, 201, 204] });

    // Withdraw branch — third distinct cash-in.
    ctx.currentStep = 'create-withdraw';
    const d3 = await http.post('/disputes', {
      transactionId: txIdWithdraw, category: 'WRONG_AMOUNT', description: 'withdraw-test',
    }, { actor: 'U1', expectStatus: [200, 201] });
    const id3 = d3.body?.id;
    assert.assert(id3, 'third dispute must return id', d3.body);
    ctx.currentStep = 'withdraw';
    await http.post(`/disputes/${id3}/withdraw`, {}, { actor: 'U1', expectStatus: [200, 201, 204] });
  },
};
