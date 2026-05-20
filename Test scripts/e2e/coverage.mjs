const EXCLUDED_OPS = new Set([
  'GET /health',
  'GET /ready',
  'GET /metrics',
]);

export function buildCoverageReport(ctx) {
  const ops = ctx.openapi.listOps();

  // Authenticated 2xx hits only — N-0 unauthenticated probes do NOT count.
  const authenticatedHits = ctx.hits.filter(h => h.authenticated && h.status < 400);
  const probeHits = ctx.hits.filter(h => !h.authenticated || h.status >= 400);

  const hitSet = new Set();
  const opStatus = new Map();
  for (const h of authenticatedHits) {
    const tplKey = templateKeyFor(h.method, h.path, ops);
    hitSet.add(tplKey);
    opStatus.set(tplKey, h.status);
  }

  // Public endpoints are "covered" by any successful call (auth or not).
  for (const h of probeHits) {
    if (h.status < 400) {
      const tplKey = templateKeyFor(h.method, h.path, ops);
      const op = ops.find(o => `${o.method} ${o.path}` === tplKey);
      if (op?.isPublic) {
        hitSet.add(tplKey);
        if (!opStatus.has(tplKey)) opStatus.set(tplKey, h.status);
      }
    }
  }

  const eligibleOps = ops.filter(op => !EXCLUDED_OPS.has(`${op.method} ${op.path}`));
  const hit = [];
  const miss = [];
  for (const op of eligibleOps) {
    const key = `${op.method} ${op.path}`;
    if (hitSet.has(key)) hit.push({ ...op, lastStatus: opStatus.get(key) });
    else miss.push(op);
  }
  const total = eligibleOps.length;
  const pct = total === 0 ? 100 : Math.round((hit.length / total) * 1000) / 10;
  return {
    hit, miss, total,
    hitCount: hit.length, missCount: miss.length, pct,
    securityProbeCount: probeHits.length,
  };
}

function templateKeyFor(method, concrete, ops) {
  const direct = ops.find(op => op.method === method && op.path === concrete);
  if (direct) return `${direct.method} ${direct.path}`;
  for (const op of ops) {
    if (op.method !== method) continue;
    const tParts = op.path.split('/');
    const cParts = concrete.split('?')[0].split('/');
    if (tParts.length !== cParts.length) continue;
    let ok = true;
    for (let i = 0; i < tParts.length; i++) {
      const t = tParts[i], c = cParts[i];
      if (t.startsWith('{') && t.endsWith('}')) continue;
      if (t !== c) { ok = false; break; }
    }
    if (ok) return `${op.method} ${op.path}`;
  }
  return `${method} ${concrete}`;
}

export function printCoverage(ctx, report) {
  const { log } = ctx;
  log.info(`Endpoint coverage (authenticated 2xx): ${report.hitCount}/${report.total} (${report.pct}%)`);
  log.info(`Security probe hits (N-0 + unauth): ${report.securityProbeCount}`);
  log.debug('Hit list', report.hit.map(o => `${o.method} ${o.path}`));
  if (report.miss.length > 0) {
    log.warn(`${report.miss.length} endpoints not hit by an authenticated 2xx call:`);
    for (const op of report.miss) log.warn(`  - ${op.method} ${op.path}`);
  }
}
