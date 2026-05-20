export function createAssert(ctx) {
  function assert(cond, message, data) {
    if (!cond) {
      const scope = ctx.currentFlow ? `${ctx.currentFlow}${ctx.currentStep ? '.' + ctx.currentStep : ''}` : null;
      ctx.log.fail(`assert: ${message}`, data, scope);
      const err = new Error(`assertion failed: ${message}`);
      err.assertion = { message, data };
      throw err;
    }
  }
  function assertStatus(resp, expected, label = '') {
    const list = Array.isArray(expected) ? expected : [expected];
    assert(list.includes(resp.status), `${label} expected status ${list.join('|')} got ${resp.status}`, { body: resp.body });
  }
  function assertShape(obj, fields, label = 'body') {
    for (const f of fields) {
      assert(obj && obj[f] !== undefined, `${label}.${f} missing`, { actual: obj });
    }
  }
  function assertErrorCode(resp, code, label = '') {
    const got = resp?.body?.code ?? resp?.body?.error?.code;
    assert(got === code, `${label} expected error code ${code} got ${got}`, { body: resp.body });
  }
  async function assertEventually(predicate, { timeoutMs = 15_000, intervalMs = 250, label = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        const value = await predicate();
        if (value) return value;
        last = value;
      } catch (err) { last = err; }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    assert(false, `eventually(${label}) timed out after ${timeoutMs}ms`, { last: String(last) });
  }
  function skip(message) {
    const err = new Error(message);
    err.skip = true;
    throw err;
  }
  return { assert, assertStatus, assertShape, assertErrorCode, assertEventually, skip };
}
