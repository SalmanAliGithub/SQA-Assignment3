// Streaming SSE consumer using fetch.
// Returns a promise that resolves with the first event matching `predicate` or rejects on timeout.

export function listenSse({ url, headers = {}, predicate, timeoutMs = 10_000 }) {
  return new Promise(async (resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => { ac.abort(); reject(new Error(`SSE timeout after ${timeoutMs}ms`)); }, timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', headers: { ...headers, accept: 'text/event-stream' }, signal: ac.signal });
      if (!res.ok || !res.body) {
        clearTimeout(timer);
        return reject(new Error(`SSE fetch failed status=${res.status}`));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // events are separated by \n\n
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = parseEvent(block);
          if (predicate(event)) {
            clearTimeout(timer);
            ac.abort();
            return resolve(event);
          }
        }
      }
      clearTimeout(timer);
      reject(new Error('SSE stream ended without matching event'));
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') return;
      reject(err);
    }
  });
}

function parseEvent(block) {
  const ev = { event: 'message', data: '', id: null };
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') ev.event = value;
    else if (field === 'data') ev.data += (ev.data ? '\n' : '') + value;
    else if (field === 'id') ev.id = value;
  }
  try { ev.parsed = JSON.parse(ev.data); } catch {}
  return ev;
}
