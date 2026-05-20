export function createIdempotencyHelpers(ctx) {
  async function idempotentReplay({ method, path, key, body, expect, headers }) {
    const { http } = ctx;
    const opts = { headers, idempotencyKey: key, allowStatus: [200, 201, 202, 409, 422] };
    const m = method.toUpperCase();
    const first = await http.request({ method: m, path, body, ...opts });
    let second;
    if (expect === 'duplicate') {
      second = await http.request({ method: m, path, body, ...opts });
      ctx.assert.assert(
        [200, 201, 202].includes(second.status),
        `idempotent replay of ${m} ${path} expected 2xx got ${second.status}`,
        { first: first.body, second: second.body },
      );
    } else if (expect === 'conflict') {
      const mutated = { ...body, __mutated: true };
      second = await http.request({ method: m, path, body: mutated, ...opts });
      ctx.assert.assert(
        second.status === 409,
        `idempotent conflict on ${m} ${path} expected 409 got ${second.status}`,
        { first: first.body, second: second.body },
      );
    }
    return { first, second };
  }
  return { idempotentReplay };
}
