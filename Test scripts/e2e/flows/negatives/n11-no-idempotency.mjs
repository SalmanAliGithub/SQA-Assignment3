export default {
  id: 'N-11', name: 'POST /transfers without Idempotency-Key → 400',
  dependsOn: ['F-12'], actors: ['U1'],
  endpoints: ['POST /transfers'],
  async run(ctx) {
    const r = await ctx.http.post('/transfers', { recipientPhone: ctx.actors.U2.phone, amount: '1.00' }, {
      actor: 'U1', idempotencyKey: false, allowStatus: [400, 401, 422],
    });
    ctx.assert.assert(r.status === 400 || r.status === 422, 'missing idempotency-key must be rejected', r.body);
  },
};
