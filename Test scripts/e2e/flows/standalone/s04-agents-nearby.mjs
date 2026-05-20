export default {
  id: 'S-4',
  name: 'GET /cico/agents/nearby (empty + populated)',
  dependsOn: ['F-1'],
  actors: ['U1'],
  endpoints: ['GET /cico/agents/nearby'],
  async run(ctx) {
    const { http } = ctx;
    await http.get('/cico/agents/nearby', { actor: 'U1', query: { lat: 0, lng: 0, radiusKm: 1 }, allowStatus: [200, 404] });
    await http.get('/cico/agents/nearby', { actor: 'U1', query: { lat: 9.03, lng: 38.74, radiusKm: 50 }, allowStatus: [200, 404] });
  },
};
