import * as crypto from 'crypto';

export const CODE_TTL_SECONDS = 10 * 60;
export const CODE_COOLDOWN_SECONDS = 30;
export const MAX_CODE_ATTEMPTS = 5;

export type CodeRequestOutcome = 'sent' | 'throttled' | 'delivery-failed';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function matchesHash(candidate: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(sha256(candidate), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return candidateHash.length === expected.length && crypto.timingSafeEqual(candidateHash, expected);
}

export function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
