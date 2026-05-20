import { randomUUID } from 'node:crypto';
import { redact, redactHeaders } from './logger.mjs';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createHttpClient(ctx) {
  const baseUrl = ctx.opts.baseUrl;

  async function request({ method, path, query, body, headers = {}, idempotencyKey, actor, expectStatus, noAuth, allowStatus, multipart, operationIdOverride }) {
    const m = method.toUpperCase();
    const url = buildUrl(baseUrl, path, query);
    const reqHeaders = { ...headers };

    // Auth
    let effectiveActor = null;
    let authApplied = false;
    if (!noAuth) {
      effectiveActor = actor ?? ctx.currentActor;
      if (effectiveActor) {
        const a = ctx.actors[effectiveActor];
        if (a?.accessToken) {
          reqHeaders['authorization'] = `Bearer ${a.accessToken}`;
          authApplied = true;
        }
      }
    }

    // Idempotency-Key
    let appliedKey = null;
    if (MUTATING.has(m) && idempotencyKey !== false) {
      appliedKey = typeof idempotencyKey === 'string' && idempotencyKey.length > 0 ? idempotencyKey : randomUUID();
      reqHeaders['idempotency-key'] = appliedKey;
    }

    // Body
    let payload;
    if (multipart instanceof FormData) {
      payload = multipart;
      // do NOT set content-type — fetch sets boundary
    } else if (body !== undefined && body !== null) {
      if (!reqHeaders['content-type']) reqHeaders['content-type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const scope = ctx.currentFlow ? `${ctx.currentFlow}${ctx.currentStep ? '.' + ctx.currentStep : ''}` : null;
    ctx.log.debug(`→ ${m} ${path}`, {
      url, query, headers: redactHeaders(reqHeaders), body: multipart ? '<multipart>' : redact(body),
    }, scope);

    const startedAt = Date.now();
    let response, text, status, parsedBody;
    try {
      response = await fetch(url, { method: m, headers: reqHeaders, body: payload, redirect: 'manual' });
      status = response.status;
      text = await response.text();
      try { parsedBody = text ? JSON.parse(text) : null; } catch { parsedBody = text; }
    } catch (err) {
      ctx.log.error(`✗ ${m} ${path} (network)`, { error: String(err) }, scope);
      throw err;
    }
    const durationMs = Date.now() - startedAt;

    const operationId = operationIdOverride || ctx.openapi?.opForRoute(m, path) || `${m} ${path}`;
    ctx.hits.push({
      operationId, method: m, path, status, durationMs,
      actor: effectiveActor,
      authenticated: authApplied,
    });

    ctx.log.debug(`← ${status} ${m} ${path}`, {
      durationMs,
      body: typeof parsedBody === 'object' ? redact(parsedBody) : parsedBody,
    }, scope);

    const expected = Array.isArray(expectStatus) ? expectStatus : (expectStatus ? [expectStatus] : null);
    const allowed = allowStatus ? (Array.isArray(allowStatus) ? allowStatus : [allowStatus]) : null;
    if (expected && !expected.includes(status)) {
      ctx.log.fail(`HTTP ${m} ${path} expected ${expected.join('|')} got ${status}`, { body: parsedBody }, scope);
      const err = new Error(`HTTP ${m} ${path} expected ${expected.join('|')} got ${status}: ${typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody)}`);
      err.response = { status, body: parsedBody };
      throw err;
    }
    if (allowed && !allowed.includes(status)) {
      const err = new Error(`HTTP ${m} ${path} unexpected ${status}`);
      err.response = { status, body: parsedBody };
      throw err;
    }

    return { status, body: parsedBody, raw: text, headers: response.headers, idempotencyKey: appliedKey, durationMs };
  }

  return {
    request,
    get: (path, opts = {}) => request({ method: 'GET', path, ...opts }),
    post: (path, body, opts = {}) => request({ method: 'POST', path, body, ...opts }),
    patch: (path, body, opts = {}) => request({ method: 'PATCH', path, body, ...opts }),
    put: (path, body, opts = {}) => request({ method: 'PUT', path, body, ...opts }),
    del: (path, opts = {}) => request({ method: 'DELETE', path, ...opts }),
  };
}

function buildUrl(base, path, query) {
  let url = base + (path.startsWith('/') ? path : '/' + path);
  if (query && Object.keys(query).length > 0) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach(x => usp.append(k, String(x)));
      else usp.append(k, String(v));
    }
    const qs = usp.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}
