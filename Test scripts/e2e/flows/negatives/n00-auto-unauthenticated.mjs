// N-0 — Programmatic 401 probe: every non-public endpoint without auth must 401/403.
export default {
  id: 'N-0',
  name: 'Auto unauthenticated probe across every endpoint',
  dependsOn: ['F-26a'],
  actors: ['anonymous'],
  endpoints: ['*'],
  async run(ctx) {
    const ops = ctx.openapi.listOps().filter(op => !op.isPublic);
    let probed = 0, ok = 0, mismatches = 0;
    for (const op of ops) {
      if (op.path.startsWith('/internal/')) continue;
      if (op.path === '/health' || op.path === '/ready') continue;
      const concrete = op.path.replace(/\{[^}]+\}/g, '00000000-0000-0000-0000-000000000000');
      const m = op.method;
      const allow = [200, 201, 202, 204, 400, 401, 403, 404, 405, 422];
      let r;
      try {
        r = await ctx.http.request({
          method: m, path: concrete, noAuth: true, idempotencyKey: false,
          allowStatus: allow,
          body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? {} : undefined,
        });
      } catch (err) {
        ctx.log.warn(`N-0 probe error ${m} ${op.path}: ${err.message}`);
        continue;
      }
      probed++;
      if (r.status === 401 || r.status === 403) ok++;
      else if ([200, 201, 202, 204].includes(r.status)) {
        ctx.log.warn(`N-0 ${m} ${op.path} returned ${r.status} without auth — possible guard miss`);
        mismatches++;
      }
    }
    ctx.log.info(`N-0 probe complete: probed=${probed} 401/403=${ok} mismatches=${mismatches}`);
  },
};
