export default {
  id: 'N-7', name: 'USER calls GET /admin/probe → 403', dependsOn: ['F-1'], actors: ['U1'],
  endpoints: ['GET /admin/probe'],
  async run(ctx) {
    const r = await ctx.http.get('/admin/probe', { actor: 'U1', allowStatus: [401, 403] });
    ctx.assert.assert([401, 403].includes(r.status), 'expected 401/403', r.body);
  },
};
