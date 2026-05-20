export default {
  id: 'S-3',
  name: 'GET /admin/financing/products',
  dependsOn: ['F-7'],
  actors: ['AD1'],
  endpoints: ['GET /admin/financing/products'],
  async run(ctx) {
    await ctx.http.get('/admin/financing/products', { actor: 'AD1', expectStatus: 200 });
  },
};
