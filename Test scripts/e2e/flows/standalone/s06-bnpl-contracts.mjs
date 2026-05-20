export default {
  id: 'S-6',
  name: 'GET /me/bnpl/contracts (populated after F-16)',
  dependsOn: ['F-16'],
  actors: ['U1'],
  endpoints: ['GET /me/bnpl/contracts'],
  async run(ctx) {
    await ctx.http.get('/me/bnpl/contracts', { actor: 'U1', expectStatus: 200 });
  },
};
