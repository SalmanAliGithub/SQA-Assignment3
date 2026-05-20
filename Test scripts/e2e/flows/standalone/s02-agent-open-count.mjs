export default {
  id: 'S-2',
  name: 'GET /me/agent/disputes/open-count',
  dependsOn: ['F-9'],
  actors: ['AG1'],
  endpoints: ['GET /me/agent/disputes/open-count'],
  async run(ctx) {
    await ctx.http.get('/me/agent/disputes/open-count', { actor: 'AG1', expectStatus: 200 });
  },
};
