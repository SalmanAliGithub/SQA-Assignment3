export async function waitFor(predicate, { timeoutMs = 15_000, intervalMs = 250, label = 'wait' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const v = await predicate();
      if (v) return v;
      last = v;
    } catch (err) { last = err; }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms (last=${JSON.stringify(String(last))})`);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
