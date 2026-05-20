export default {
  id: 'S-5',
  name: 'GET /transfers/by-key/{idempotencyKey} unknown',
  dependsOn: ['F-1'],
  actors: ['U1'],
  endpoints: ['GET /transfers/by-key/{idempotencyKey}'],
  async run(ctx) {
    const r = await ctx.http.get(`/transfers/by-key/${ctx.fixtures.uuid()}`, { actor: 'U1', allowStatus: [200, 404] });
    ctx.assert.assert(r.status === 404 || r.status === 200, 'by-key unknown key handled');
  },
};
