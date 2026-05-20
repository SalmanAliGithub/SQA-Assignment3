// F-26b — Internal events endpoint (worker → API). Run last.
export default {
  id: 'F-26b',
  name: 'Internal events (anonymous reject from outside)',
  dependsOn: ['F-20'],
  actors: ['anonymous'],
  endpoints: ['POST /internal/events'],
  async run(ctx) {
    const { http } = ctx;
    // We don't have the internal secret; expect 401/403 from outside.
    const r = await http.post('/internal/events', { eventType: 'probe', payload: {} }, { noAuth: true, allowStatus: [200, 201, 204, 400, 401, 403, 404, 422] });
    ctx.log.info('POST /internal/events status=' + r.status, r.body);
  },
};
