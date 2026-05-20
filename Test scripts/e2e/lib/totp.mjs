import { authenticator } from 'otplib';

authenticator.options = { window: 2, step: 30 };

export function totpGenerate(secret) {
  return authenticator.generate(secret);
}

export function totpVerify(token, secret) {
  return authenticator.check(token, secret);
}

// Extract secret from an otpauth URI like otpauth://totp/Maal:admin@maal.local?secret=BASE32&...
export function extractSecretFromUri(uri) {
  try {
    const u = new URL(uri);
    return u.searchParams.get('secret');
  } catch {
    const m = /[?&]secret=([A-Z2-7]+)/.exec(uri);
    return m ? m[1] : null;
  }
}
