// Builds a DAG from the provided flow modules and runs them in topological order.
// On a flow's FAILURE, any downstream flow with that flow in `dependsOn` is SKIPPED.

export async function runFlows(ctx, flows, { only = null, skip = null } = {}) {
  const byId = new Map(flows.map(f => [f.id, f]));
  for (const f of flows) {
    for (const dep of (f.dependsOn || [])) {
      if (!byId.has(dep)) {
        ctx.log.warn(`Flow ${f.id} declares dependsOn=${dep} which is not registered`);
      }
    }
  }

  const order = topoSort(flows);

  // results: flowId -> 'PASS' | 'FAIL' | 'SKIP' | 'BLOCKED'
  for (const flow of order) {
    if (only && !only.includes(flow.id)) {
      ctx.results[flow.id] = { status: 'SKIP', reason: 'not in --only filter' };
      ctx.log.skip(`${flow.id} (filtered)`, null, flow.id);
      continue;
    }
    if (skip && skip.includes(flow.id)) {
      ctx.results[flow.id] = { status: 'SKIP', reason: '--skip filter' };
      ctx.log.skip(`${flow.id} (filtered out)`, null, flow.id);
      continue;
    }
    const blocked = (flow.dependsOn || []).filter(d => {
      const r = ctx.results[d];
      return r && (r.status === 'FAIL' || r.status === 'BLOCKED' || r.status === 'SKIP');
    });
    if (blocked.length > 0) {
      ctx.results[flow.id] = { status: 'BLOCKED', reason: `dependsOn ${blocked.join(',')} not PASS` };
      ctx.log.skip(`${flow.id} BLOCKED (deps ${blocked.join(',')})`, null, flow.id);
      continue;
    }

    ctx.currentFlow = flow.id;
    ctx.currentStep = null;
    ctx.log.flow(`▶ ${flow.id} — ${flow.name}`, { actors: flow.actors }, flow.id);
    const started = Date.now();
    try {
      await flow.run(ctx);
      const dur = Date.now() - started;
      ctx.results[flow.id] = { status: 'PASS', durationMs: dur };
      ctx.log.pass(`${flow.id} (${dur}ms)`, null, flow.id);
    } catch (err) {
      const dur = Date.now() - started;
      if (err && err.skip) {
        ctx.results[flow.id] = { status: 'SKIP', durationMs: dur, reason: err.message };
        ctx.log.skip(`${flow.id} SKIPPED: ${err.message}`, null, flow.id);
      } else {
        ctx.results[flow.id] = { status: 'FAIL', durationMs: dur, error: String(err.message || err) };
        ctx.log.fail(`${flow.id} (${dur}ms): ${err.message || err}`, { stack: String(err.stack || '').split('\n').slice(0, 6).join('\n') }, flow.id);
      }
    }
    ctx.currentFlow = null;
    ctx.currentStep = null;
  }
}

export function topoSort(flows) {
  // Kahn's algorithm with stable ordering by id
  const byId = new Map(flows.map(f => [f.id, f]));
  const inDeg = new Map(flows.map(f => [f.id, 0]));
  const edges = new Map(flows.map(f => [f.id, []]));
  for (const f of flows) {
    for (const dep of (f.dependsOn || [])) {
      if (byId.has(dep)) {
        edges.get(dep).push(f.id);
        inDeg.set(f.id, inDeg.get(f.id) + 1);
      }
    }
  }
  const ready = flows.filter(f => inDeg.get(f.id) === 0).map(f => f.id).sort(stableId);
  const out = [];
  while (ready.length) {
    ready.sort(stableId);
    const id = ready.shift();
    out.push(byId.get(id));
    for (const next of edges.get(id)) {
      inDeg.set(next, inDeg.get(next) - 1);
      if (inDeg.get(next) === 0) ready.push(next);
    }
  }
  if (out.length !== flows.length) {
    throw new Error('Cycle detected in flow DAG: registered=' + flows.length + ' sorted=' + out.length);
  }
  return out;
}

function stableId(a, b) {
  // Sort by category (B<F<S<N), then by numeric suffix
  const order = (s) => {
    const cat = { B: 0, F: 1, S: 2, N: 3 }[s[0]] ?? 4;
    const num = parseInt(s.slice(2).replace(/[^\d]/g, ''), 10) || 0;
    return cat * 1000 + num;
  };
  return order(a) - order(b);
}

export function printDag(flows) {
  const order = topoSort(flows);
  console.log(`# Flow DAG (${order.length} flows in topological order)\n`);
  for (const f of order) {
    const deps = (f.dependsOn || []).length ? ` ← [${f.dependsOn.join(', ')}]` : '';
    console.log(`${f.id.padEnd(8)} ${f.name}${deps}`);
  }
}
