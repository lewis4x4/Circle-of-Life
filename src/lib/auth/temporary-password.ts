/**
 * Temporary-password generation and expiry.
 *
 * A temp password is a credential an admin reads aloud or pastes into a message. It is
 * the weakest thing in the auth path, so it gets a uniform generator, guaranteed class
 * coverage, and a hard expiry (COL-362).
 */

/** Ambiguous glyphs (I, l, 1, O, 0) are excluded — these get read over the phone. */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%";
const ALPHABET = `${UPPER}${LOWER}${DIGIT}${SYMBOL}`;

export const TEMPORARY_PASSWORD_LENGTH = 20;
export const TEMPORARY_PASSWORD_ALPHABET = ALPHABET;

/**
 * Uniform index in [0, max) via rejection sampling.
 *
 * The previous implementation was `byte % alphabet.length` over a 61-character
 * alphabet. 256 mod 61 = 12, so the first 12 characters came up 5/256 of the time
 * against 4/256 for the rest — a 25% skew that shaves entropy off every position.
 */
function uniformIndex(max: number): number {
  if (max <= 0 || max > 256) {
    throw new Error(`uniformIndex: unsupported range ${max}`);
  }
  // Largest multiple of `max` that fits in a byte; anything at or above it is rejected.
  const limit = Math.floor(256 / max) * max;
  const buffer = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) {
      return buffer[0] % max;
    }
  }
}

function pick(source: string): string {
  return source[uniformIndex(source.length)];
}

/** Fisher-Yates over a uniform index, so position carries no information about class. */
function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = uniformIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/**
 * Generate a temporary password. Guarantees at least one character from each class,
 * so it cannot fail a password policy by chance.
 */
export function generateSecurePassword(length: number = TEMPORARY_PASSWORD_LENGTH): string {
  if (length < 4) {
    throw new Error("generateSecurePassword: length must be at least 4");
  }

  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < length) {
    chars.push(pick(ALPHABET));
  }

  return shuffle(chars).join("");
}

// ── Expiry ────────────────────────────────────────────────────────

/**
 * How long a temporary password stays usable. An admin hands it over in the same
 * conversation; 72 hours covers a Friday hand-off without leaving a live credential
 * sitting in a text thread indefinitely.
 */
export const TEMPORARY_PASSWORD_TTL_HOURS = 72;

export const TEMPORARY_PASSWORD_EXPIRES_AT_KEY = "must_change_password_expires_at";

export function temporaryPasswordExpiresAt(issuedAt: Date = new Date()): string {
  return new Date(issuedAt.getTime() + TEMPORARY_PASSWORD_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * Is a temporary password past its expiry?
 *
 * The boundary is inclusive of expiry: at exactly `expiresAt` the credential is
 * expired. A missing or unparseable value is treated as expired — a forced-change
 * obligation with no readable deadline is not something to fail open on.
 */
export function isTemporaryPasswordExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) {
    return true;
  }
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) {
    return true;
  }
  return now.getTime() >= deadline;
}
