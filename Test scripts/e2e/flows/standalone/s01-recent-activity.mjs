export default {
  id: 'S-1',
  name: 'GET /admin/dashboard/recent-activity (standalone)',
  dependsOn: ['F-7'],
  actors: ['AD1'],
  endpoints: ['GET /admin/dashboard/recent-activity'],
  async run(ctx) {
    await ctx.http.get('/admin/dashboard/recent-activity', { actor: 'AD1', query: { limit: 5 }, expectStatus: 200 });
  },
};
