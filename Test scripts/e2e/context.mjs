export function createContext(opts) {
  const runId = Math.floor(Date.now() / 1000) % 10000;
  return {
    opts,
    runId: String(runId).padStart(4, '0'),
    startedAt: new Date().toISOString(),
    actors: {},          // label -> { phone, pin, deviceId, accessToken, refreshToken, userId, role, ... }
    fixtures: {},        // misc state, ids, tokens
    transactions: [],    // [{ id, type, amount, ... }]
    uploads: [],         // [{ uploadId, type }]
    hits: [],            // [{ method, path, status, operationId }]
    results: {},         // flowId -> { status, durationMs, error, steps:[] }
    log: null,           // injected by run.mjs
    http: null,          // injected
    openapi: null,       // injected
    sms: null,           // injected sms-stub helper
    totp: null,          // injected
    poll: null,          // injected
    assert: null,        // injected
    currentActor: null,  // label of the actor whose token http auto-injects
    currentFlow: null,
    currentStep: null,
  };
}

export function setActor(ctx, label) {
  if (!ctx.actors[label]) throw new Error(`Unknown actor ${label}`);
  ctx.currentActor = label;
  return ctx.actors[label];
}

export function asActor(ctx, label, fn) {
  const prev = ctx.currentActor;
  ctx.currentActor = label;
  return Promise.resolve(fn(ctx.actors[label])).finally(() => { ctx.currentActor = prev; });
}

export function recordActor(ctx, label, data) {
  ctx.actors[label] = { ...(ctx.actors[label] || {}), ...data, label };
  return ctx.actors[label];
}
