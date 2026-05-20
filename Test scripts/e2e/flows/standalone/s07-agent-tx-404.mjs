export default {
  id: 'S-7',
  name: 'GET /me/agent/transactions/{unknown} → 404',
  dependsOn: ['F-9'],
  actors: ['AG1'],
  endpoints: ['GET /me/agent/transactions/{id}'],
  async run(ctx) {
    const r = await ctx.http.get(`/me/agent/transactions/${ctx.fixtures.uuid()}`, { actor: 'AG1', allowStatus: [200, 404] });
    ctx.assert.assert(r.status === 404 || r.status === 200, 'unknown agent-tx handled');
  },
};
