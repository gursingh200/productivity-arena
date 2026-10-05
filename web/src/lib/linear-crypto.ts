import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.ARENA_SECRET;
  if (!secret) {
    throw new Error("ARENA_SECRET is not set");
  }
  // Accept raw hex key (32 bytes = 64 hex chars) or derive from arbitrary string
  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  // Derive 32-byte key from arbitrary string
  return scryptSync(secret, "arena-linear-salt", 32);
}

/**
 * Encrypt a Linear API key. Returns base64-encoded: iv + tag + ciphertext.
 */
export function encryptApiKey(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * Decrypt a Linear API key.
 */
export function decryptApiKey(encrypted: string): string {
  const key = getKey();
  const buf = Buffer.from(encrypted, "base64");

  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
