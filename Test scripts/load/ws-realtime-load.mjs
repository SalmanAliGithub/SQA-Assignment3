#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * WebSocket realtime load test for /ws/notifications.
 *
 * Spins up N concurrent connections, holds them for HOLD_SECONDS, and
 * reports connection success rate, average connect latency, message
 * throughput, and disconnect counts.
 *
 * Usage:
 *   node tools/load/ws-realtime-load.mjs \
 *     --base ws://localhost:3000 \
 *     --token-file .data/load-tokens.json \
 *     --connections 1000 \
 *     --hold 60
 *
 * The token file must be a JSON array of strings — one access JWT per
 * desired session. Tokens are reused round-robin if there are fewer
 * tokens than connections (you can use a single test token to validate
 * fan-out, but use distinct tokens for a realistic mix).
 */
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

function parseArgs(argv) {
  const out = {
    base: process.env.WS_LOAD_BASE ?? 'ws://localhost:3000',
    tokenFile: process.env.WS_LOAD_TOKEN_FILE,
    connections: Number.parseInt(process.env.WS_LOAD_CONNECTIONS ?? '1000', 10),
    hold: Number.parseInt(process.env.WS_LOAD_HOLD ?? '60', 10),
    rampSeconds: Number.parseInt(process.env.WS_LOAD_RAMP ?? '20', 10),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--base':
        out.base = next;
        i += 1;
        break;
      case '--token-file':
        out.tokenFile = next;
        i += 1;
        break;
      case '--connections':
        out.connections = Number.parseInt(next, 10);
        i += 1;
        break;
      case '--hold':
        out.hold = Number.parseInt(next, 10);
        i += 1;
        break;
      case '--ramp':
        out.rampSeconds = Number.parseInt(next, 10);
        i += 1;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown flag: ${arg}`);
        }
    }
  }
  if (!out.tokenFile) {
    throw new Error('Missing --token-file (or WS_LOAD_TOKEN_FILE env var)');
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const tokensRaw = await readFile(args.tokenFile, 'utf8');
  const tokens = JSON.parse(tokensRaw);
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('Token file must be a non-empty JSON array');
  }

  const stats = {
    attempted: 0,
    opened: 0,
    failedOpen: 0,
    closed: 0,
    messagesReceived: 0,
    pongCount: 0,
    connectLatencies: [],
  };

  const sockets = [];
  const rampDelayMs = Math.max(
    1,
    Math.floor((args.rampSeconds * 1000) / args.connections),
  );

  for (let i = 0; i < args.connections; i += 1) {
    const token = tokens[i % tokens.length];
    const url = `${args.base}/ws/notifications?token=${encodeURIComponent(token)}`;
    const start = performance.now();
    stats.attempted += 1;
    const socket = new WebSocket(url);

    socket.on('open', () => {
      stats.opened += 1;
      stats.connectLatencies.push(performance.now() - start);
    });
    socket.on('message', () => {
      stats.messagesReceived += 1;
    });
    socket.on('pong', () => {
      stats.pongCount += 1;
    });
    socket.on('close', () => {
      stats.closed += 1;
    });
    socket.on('error', () => {
      stats.failedOpen += 1;
    });

    sockets.push(socket);
    await new Promise((resolve) => setTimeout(resolve, rampDelayMs));
  }

  console.error(
    `Connected ${stats.opened}/${args.connections} after ramp; holding ${args.hold}s...`,
  );

  await new Promise((resolve) => setTimeout(resolve, args.hold * 1000));

  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'load test complete');
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const sortedLatencies = [...stats.connectLatencies].sort((a, b) => a - b);
  const p = (q) =>
    sortedLatencies.length > 0
      ? sortedLatencies[Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * q))]
      : 0;
  const summary = {
    attempted: stats.attempted,
    opened: stats.opened,
    failed: stats.failedOpen,
    closed: stats.closed,
    messagesReceived: stats.messagesReceived,
    pongs: stats.pongCount,
    connectLatencyMs: {
      p50: Math.round(p(0.5)),
      p95: Math.round(p(0.95)),
      p99: Math.round(p(0.99)),
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  if (stats.opened < args.connections) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
