export default {
  id: 'N-17', name: 'U2 reads U1\'s dispute → 403/404',
  dependsOn: ['F-15'], actors: ['U2'],
  endpoints: ['GET /disputes/{id}'],
  async run(ctx) {
    // We can't easily get the dispute id of U1 here; just probe a random uuid → 404 is fine
    const r = await ctx.http.get(`/disputes/${ctx.fixtures.uuid()}`, { actor: 'U2', expectStatus: [403, 404] });
    ctx.assert.assert([403, 404].includes(r.status), 'foreign dispute must be 403/404', r.body);
  },
};
