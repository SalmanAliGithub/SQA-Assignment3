export default {
  id: 'S-9',
  name: 'GET /admin/financing/contracts/{id}',
  dependsOn: ['F-16'],
  actors: ['AD1'],
  endpoints: ['GET /admin/financing/contracts/{id}'],
  async run(ctx) {
    // pick any contract from list
    const r = await ctx.http.get('/admin/financing/contracts', { actor: 'AD1', query: { limit: 1 }, expectStatus: 200 });
    const items = r.body?.items || r.body?.data || r.body || [];
    if (items[0]?.id) {
      await ctx.http.get(`/admin/financing/contracts/${items[0].id}`, { actor: 'AD1', allowStatus: [200, 404] });
    }
  },
};
