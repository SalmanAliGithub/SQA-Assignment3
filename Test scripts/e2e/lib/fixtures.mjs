import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

const FIXED_PHONES = {
  U1: '+251911000001',
  U2: '+251911000002',
  U3: '+251911000003',
  U4: '+251911000004',
  AG1: '+251922000001',
  AG2: '+251922000002',
  AC1: '+251933000001',
};

export function createFixtures(ctx) {
  let counter = 0;
  function nextPhone(label) {
    if (ctx.opts.fixedPhones && FIXED_PHONES[label]) return FIXED_PHONES[label];
    counter += 1;
    const seq = String(counter).padStart(3, '0');
    return `+25191${ctx.runId}${seq}`;
  }
  function uuid() { return randomUUID(); }
  function tinyPng() {
    // 1x1 transparent PNG
    return Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000050001da' +
      'a1c4f000000000049454e44ae426082',
      'hex',
    );
  }
  function pinHash(pin) {
    // For /auth/pin/change endpoint which expects pinHash (sha256(pin+pepper))
    const pepper = process.env.BCRYPT_PEPPER || 'dev-bcrypt-pepper';
    const crypto = (globalThis.crypto && globalThis.crypto.subtle) ? null : null;
    // Use node:crypto sync for determinism
    // We don't actually know server-side hashing; the route may accept raw pin. Provide both:
    return { raw: pin, pepper };
  }
  return { nextPhone, uuid, tinyPng, pinHash, FIXED_PHONES };
}
