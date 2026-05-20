// F-25 — Agent commission CSV export.
export default {
  id: 'F-25',
  name: 'Agent commission export',
  dependsOn: ['F-9'],
  actors: ['AG1'],
  endpoints: ['POST /me/agent/commissions/export'],
  async run(ctx) {
    const { http } = ctx;
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    await http.post('/me/agent/commissions/export', { from: start, to: today, format: 'csv' }, {
      actor: 'AG1', expectStatus: [200, 201, 202],
    });
  },
};
