// F-26a — Health / readiness pre-flight (must run first).
export default {
  id: 'F-26a',
  name: 'Health & readiness pre-flight',
  dependsOn: [],
  actors: ['anonymous'],
  endpoints: ['/health', '/ready'],
  async run(ctx) {
    const { http, log } = ctx;
    ctx.currentStep = 'health';
    const h = await http.get('/health', { noAuth: true, expectStatus: [200, 503] });
    log.info('GET /health', { status: h.status, body: h.body });

    ctx.currentStep = 'ready';
    const r = await http.get('/ready', { noAuth: true, allowStatus: [200, 503] });
    log.info('GET /ready', { status: r.status, body: r.body });
  },
};
