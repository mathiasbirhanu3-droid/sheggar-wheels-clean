// Password hashing — Node's built-in scrypt (memory-hard KDF, FIPS-recognized).
// Deliberately zero new dependencies: scrypt ships with Node, resists GPU
// cracking far better than bcrypt, and timingSafeEqual gives constant-time
// comparison. Storage format (self-describing, parameter-upgrade friendly):
//
//   scrypt$N=16384$r=8$p=1$<salt hex 16B>$<hash hex 64B>
//
// NOTE: intentionally NOT marked "server-only" so prisma/seed.ts can import
// it under plain tsx. Never import this from a client component — it pulls
// node:crypto into the browser bundle.
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1 } as const; // OWASP-recommended baseline
const KEY_LEN = 64;

/** Hash a plaintext password into the storable self-describing string. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, KEY_LEN, PARAMS);
  return `scrypt$N=${PARAMS.N}$r=${PARAMS.r}$p=${PARAMS.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verification. Returns false for null/malformed hashes. */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  // scrypt$N=..$r=..$p=..$salt$hash → 6 segments
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1].split("=")[1]);
  const r = Number(parts[2].split("=")[1]);
  const p = Number(parts[3].split("=")[1]);
  if (!N || !r || !p) return false;
  try {
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
    const actual = await scrypt(plain, salt, expected.length, { N, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
