import { mkdirSync, createWriteStream, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COLOR = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, PASS: 1, FAIL: 3, SKIP: 1, STEP: 1, FLOW: 1, BLOCK: 1 };
const COLORS = {
  DEBUG: COLOR.gray, INFO: COLOR.cyan, WARN: COLOR.yellow, ERROR: COLOR.red,
  PASS: COLOR.green, FAIL: COLOR.red, SKIP: COLOR.gray, STEP: COLOR.magenta, FLOW: COLOR.bold + COLOR.cyan, BLOCK: COLOR.magenta,
};

const SENSITIVE_HEADERS = new Set(['authorization', 'x-refresh-token', 'cookie']);
const SENSITIVE_BODY_KEYS = new Set([
  'pin', 'newPin', 'currentPin', 'currentPinHash', 'newPinHash',
  'password', 'currentPassword', 'newPassword',
  'otp', 'code', 'mfaCode',
  'setupToken', 'challengeToken', 'resetToken', 'refreshToken',
  'accessToken', 'secret', 'secretBase32',
]);

export function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_BODY_KEYS.has(k)) out[k] = '[REDACTED]';
    else if (typeof v === 'object') out[k] = redact(v);
    else out[k] = v;
  }
  return out;
}

export function redactHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

export function createLogger({ logDir, verbose, maxRuns }) {
  mkdirSync(logDir, { recursive: true });
  pruneOldRuns(logDir, maxRuns);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(logDir, `run-${stamp}.json`);
  const textPath = join(logDir, `run-${stamp}.log`);
  const jsonStream = createWriteStream(jsonPath, { flags: 'a' });
  const textStream = createWriteStream(textPath, { flags: 'a' });

  const consoleMin = verbose ? LEVELS.DEBUG : LEVELS.INFO;

  function write(level, scope, message, data) {
    const ts = new Date().toISOString();
    const entry = { ts, level, scope: scope || null, message, data: data ?? null };
    jsonStream.write(JSON.stringify(entry) + '\n');
    const scopeStr = scope ? `[${scope}] ` : '';
    const dataStr = data === undefined || data === null ? '' : ' ' + safeStringify(data);
    textStream.write(`${ts} ${level.padEnd(5)} ${scopeStr}${message}${dataStr}\n`);
    if (LEVELS[level] >= consoleMin) {
      const c = COLORS[level] || '';
      const consoleData = level === 'DEBUG' && !verbose ? '' : dataStr;
      console.log(`${COLOR.gray}${ts.slice(11, 23)}${COLOR.reset} ${c}${level.padEnd(5)}${COLOR.reset} ${COLOR.gray}${scopeStr}${COLOR.reset}${message}${consoleData}`);
    }
  }

  return {
    paths: { json: jsonPath, text: textPath },
    debug: (msg, data, scope) => write('DEBUG', scope, msg, data),
    info: (msg, data, scope) => write('INFO', scope, msg, data),
    warn: (msg, data, scope) => write('WARN', scope, msg, data),
    error: (msg, data, scope) => write('ERROR', scope, msg, data),
    pass: (msg, data, scope) => write('PASS', scope, msg, data),
    fail: (msg, data, scope) => write('FAIL', scope, msg, data),
    skip: (msg, data, scope) => write('SKIP', scope, msg, data),
    step: (msg, data, scope) => write('STEP', scope, msg, data),
    flow: (msg, data, scope) => write('FLOW', scope, msg, data),
    block: (msg, data, scope) => write('BLOCK', scope, msg, data),
    close: () => { jsonStream.end(); textStream.end(); },
  };
}

function safeStringify(v) {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 600 ? s.slice(0, 600) + '…' : s;
  } catch {
    return String(v);
  }
}

function pruneOldRuns(logDir, maxRuns) {
  try {
    const files = readdirSync(logDir).filter(f => f.startsWith('run-')).map(f => ({
      f,
      mtime: statSync(join(logDir, f)).mtimeMs,
    }));
    files.sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(maxRuns * 2)) {
      try { unlinkSync(join(logDir, old.f)); } catch {}
    }
  } catch {}
}
