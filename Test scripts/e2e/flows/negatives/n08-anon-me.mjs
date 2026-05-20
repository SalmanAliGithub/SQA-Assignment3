export default {
  id: 'N-8', name: 'Anonymous calls GET /me → 401', dependsOn: ['F-26a'], actors: ['anonymous'],
  endpoints: ['GET /me'],
  async run(ctx) {
    const r = await ctx.http.get('/me', { noAuth: true, allowStatus: [401, 403] });
    ctx.assert.assert([401, 403].includes(r.status), 'expected 401/403', r.body);
  },
};
