import { existsSync, readFileSync, statSync } from 'node:fs';
import { waitFor } from './polling.mjs';

const OTP_RE = /\b(\d{6})\b/;

export function createSmsReader(ctx) {
  const file = ctx.opts.smsStubFile;
  // per-phone cursor: byte offset already consumed
  const cursors = new Map();

  function readNewLinesFor(phone) {
    if (!existsSync(file)) return [];
    const size = statSync(file).size;
    const start = cursors.get(phone) || 0;
    if (size <= start) return [];
    const fd = readFileSync(file, 'utf8');
    // We read whole file then slice from byte offset. Acceptable for stub log.
    const slice = fd.slice(start);
    cursors.set(phone, fd.length);
    const lines = slice.split('\n').filter(Boolean);
    const out = [];
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (!phone || msg.to === phone) out.push(msg);
      } catch {}
    }
    return out;
  }

  function resetCursor(phone) {
    if (existsSync(file)) cursors.set(phone, statSync(file).size);
    else cursors.set(phone, 0);
  }

  async function waitForOtp(phone, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? ctx.opts.smsTimeoutMs ?? 15_000;
    return waitFor(() => {
      const msgs = readNewLinesFor(phone);
      for (const m of msgs.reverse()) {
        const match = m.body.match(OTP_RE);
        if (match) return match[1];
      }
      return null;
    }, { timeoutMs, intervalMs: 200, label: `OTP for ${phone}` });
  }

  async function waitForBodyMatch(phone, regex, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? ctx.opts.smsTimeoutMs ?? 15_000;
    return waitFor(() => {
      const msgs = readNewLinesFor(phone);
      for (const m of msgs.reverse()) {
        if (regex.test(m.body)) return m;
      }
      return null;
    }, { timeoutMs, intervalMs: 200, label: `SMS for ${phone}` });
  }

  function readAll() {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }

  return { waitForOtp, waitForBodyMatch, readNewLinesFor, resetCursor, readAll };
}
