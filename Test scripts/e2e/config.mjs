import { resolve } from 'node:path';

export const DEFAULTS = {
  baseUrl: 'http://localhost:3000',
  smsStubFile: './sms.log',
  logDir: resolve(process.cwd(), 'tools/e2e/logs'),
  notificationTimeoutMs: 15_000,
  smsTimeoutMs: 15_000,
  pollIntervalMs: 250,
  sseTimeoutMs: 10_000,
  coverageThreshold: 90,
  maxRuns: 20,
  defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL || 'admin@maal.local',
};

export function parseArgs(argv) {
  const opts = {
    baseUrl: DEFAULTS.baseUrl,
    smsStubFile: process.env.STUB_SMS_FILE || DEFAULTS.smsStubFile,
    logDir: DEFAULTS.logDir,
    coverageThreshold: DEFAULTS.coverageThreshold,
    maxRuns: DEFAULTS.maxRuns,
    verbose: false,
    reset: false,
    fixedPhones: false,
    adminFastToken: false,
    startWorker: false,
    showDag: false,
    only: null,
    skip: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--base-url':
      case '-u': opts.baseUrl = next().replace(/\/+$/, ''); break;
      case '--sms-stub-file': opts.smsStubFile = next(); break;
      case '--log-dir': opts.logDir = resolve(next()); break;
      case '--verbose': case '-v': opts.verbose = true; break;
      case '--reset': opts.reset = true; break;
      case '--fixed-phones': opts.fixedPhones = true; break;
      case '--admin-fast-token': opts.adminFastToken = true; break;
      case '--start-worker': opts.startWorker = true; break;
      case '--show-dag': opts.showDag = true; break;
      case '--coverage-threshold': opts.coverageThreshold = Number(next()); break;
      case '--max-runs': opts.maxRuns = Number(next()); break;
      case '--only': opts.only = next().split(',').map(s => s.trim()); break;
      case '--skip': opts.skip = next().split(',').map(s => s.trim()); break;
      case '--help': case '-h': printHelp(); process.exit(0);
      default:
        if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Maal E2E test harness

Usage: node tools/e2e/run.mjs [options]

Options:
  --base-url <url>            API base URL (default: ${DEFAULTS.baseUrl})
  --sms-stub-file <path>      Stub SMS JSONL log (default: ./sms.log)
  --log-dir <path>            Output log directory (default: tools/e2e/logs)
  --verbose, -v               Promote DEBUG logs to console
  --reset                     Run 'pnpm dev:reset' before tests
  --fixed-phones              Use hardcoded phone numbers from test-scenarios.md (requires reset)
  --admin-fast-token          Use dev.sh admin-token shortcut (skips F-7)
  --start-worker              Attempt to start worker if pre-flight finds none
  --show-dag                  Print flow DAG and exit
  --coverage-threshold <n>    Minimum endpoint coverage % (default: 90)
  --max-runs <n>              Keep this many log files (default: 20)
  --only F-9,F-12             Run only listed flows
  --skip F-19                 Skip listed flows
  --help, -h                  Show this help`);
}
