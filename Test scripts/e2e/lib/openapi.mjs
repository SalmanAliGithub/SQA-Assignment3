import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cached = null;

export function loadOpenApi() {
  if (cached) return cached;
  const path = resolve(process.cwd(), 'docs/backend/openapi.json');
  const spec = JSON.parse(readFileSync(path, 'utf8'));
  const ops = [];
  const byRoute = new Map();
  for (const [pathTpl, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      const m = method.toUpperCase();
      if (!['GET','POST','PUT','PATCH','DELETE'].includes(m)) continue;
      const operationId = op.operationId || `${m} ${pathTpl}`;
      const idempotency = (op.parameters || []).some(p => (p.name || '').toLowerCase() === 'idempotency-key');
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      const tags = op.tags || [];
      const entry = { operationId, method: m, path: pathTpl, idempotency, isPublic, tags, summary: op.summary };
      ops.push(entry);
      byRoute.set(`${m} ${pathTpl}`, entry);
    }
  }
  cached = {
    spec,
    ops,
    listOps: () => ops,
    opForRoute(method, concretePath) {
      // exact first
      const direct = byRoute.get(`${method.toUpperCase()} ${concretePath}`);
      if (direct) return direct.operationId;
      // template match: replace concrete segments with {param}
      for (const op of ops) {
        if (op.method !== method.toUpperCase()) continue;
        if (matchTemplate(op.path, concretePath)) return op.operationId;
      }
      return `${method.toUpperCase()} ${concretePath}`;
    },
    findByPath(method, pathTpl) {
      return byRoute.get(`${method.toUpperCase()} ${pathTpl}`) || null;
    },
  };
  return cached;
}

function matchTemplate(template, concrete) {
  const tParts = template.split('/');
  const cParts = concrete.split('?')[0].split('/');
  if (tParts.length !== cParts.length) return false;
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i], c = cParts[i];
    if (t.startsWith('{') && t.endsWith('}')) continue;
    if (t !== c) return false;
  }
  return true;
}
