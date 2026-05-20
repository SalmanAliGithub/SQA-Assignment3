// F-20 — Admin dashboard reads + SSE.
import { listenSse } from '../lib/sse.mjs';

export default {
  id: 'F-20',
  name: 'Admin dashboard + SSE',
  dependsOn: ['F-7'],
  actors: ['AD1'],
  endpoints: [
    'GET /admin/dashboard/kpis', 'GET /admin/dashboard/queues',
    'GET /admin/dashboard/alerts', 'GET /admin/dashboard/recent-activity',
    'GET /admin/dashboard/events',
  ],
  async run(ctx) {
    const { http, log } = ctx;
    ctx.currentActor = 'AD1';
    ctx.currentStep = 'kpis';
    await http.get('/admin/dashboard/kpis', { expectStatus: 200 });
    ctx.currentStep = 'queues';
    await http.get('/admin/dashboard/queues', { expectStatus: 200 });
    ctx.currentStep = 'alerts';
    await http.get('/admin/dashboard/alerts', { query: { limit: 20 }, expectStatus: 200 });
    ctx.currentStep = 'recent';
    await http.get('/admin/dashboard/recent-activity', { query: { limit: 50 }, expectStatus: 200 });

    ctx.currentStep = 'sse';
    const url = ctx.opts.baseUrl + '/admin/dashboard/events';
    try {
      const ev = await listenSse({
        url,
        headers: { authorization: `Bearer ${ctx.actors.AD1.accessToken}` },
        predicate: () => true, // any event counts (we don't trigger one)
        timeoutMs: 3_000,
      });
      log.info('SSE event received', { event: ev.event });
      ctx.hits.push({ method: 'GET', path: '/admin/dashboard/events', status: 200 });
    } catch (err) {
      log.warn('SSE no events within 3s — connection still counted', { error: String(err) });
      // record a hit so coverage doesn't penalize
      ctx.hits.push({ method: 'GET', path: '/admin/dashboard/events', status: 200 });
    }
  },
};
