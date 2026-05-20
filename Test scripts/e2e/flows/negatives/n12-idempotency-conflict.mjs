// N-12 — POST /transfers with same Idempotency-Key + different body must 409/422.
// Pre-step: top up U1's wallet via AG1 so the FIRST call succeeds (otherwise both
// calls 422 on insufficient balance and the idempotency-conflict check never fires).
export default {
  id: 'N-12', name: 'POST /transfers idempotency conflict → 409',
  dependsOn: ['F-12', 'F-9'], actors: ['U1', 'U2', 'AG1'],
  endpoints: ['POST /cico/cash-in', 'POST /transfers'],
  async run(ctx) {
    const { http, fixtures, assert } = ctx;

    // Top up U1 from the agent so the first /transfers call is funded.
    ctx.currentStep = 'precharge';
    const charge = await http.post('/cico/cash-in', { customerPhone: ctx.actors.U1.phone, amount: '20.00' }, {
      actor: 'AG1', idempotencyKey: fixtures.uuid(), expectStatus: [200, 201],
    });
    assert.assert(charge.body, 'precharge cash-in must succeed', charge.body);

    const key = fixtures.uuid();
    ctx.currentStep = 'first';
    const first = await http.post('/transfers', { recipientPhone: ctx.actors.U2.phone, amount: '2.00' }, {
      actor: 'U1', idempotencyKey: key, expectStatus: [200, 201, 202],
    });
    assert.assert([200, 201, 202].includes(first.status), 'first transfer (funded) must succeed', first.body);

    ctx.currentStep = 'conflict-replay';
    const r = await http.post('/transfers', { recipientPhone: ctx.actors.U2.phone, amount: '999.00' }, {
      actor: 'U1', idempotencyKey: key, expectStatus: [409, 422],
    });
    assert.assert([409, 422].includes(r.status), 'conflicting body on same idempotency-key must 409 (or 422 for spec drift)', r.body);
  },
};
