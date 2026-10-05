import { describe, it, expect, beforeAll } from "vitest";

// Set env before importing
beforeAll(() => {
  process.env.ARENA_SECRET = "a".repeat(64); // 64 hex chars
});

describe("linear-crypto", () => {
  it("round-trips an API key", async () => {
    const { encryptApiKey, decryptApiKey } = await import("@/lib/linear-crypto");
    const plaintext = "lin_api_test_key_12345";
    const enc = await encryptApiKey(plaintext);
    expect(enc).not.toBe(plaintext);
    const dec = await decryptApiKey(enc);
    expect(dec).toBe(plaintext);
  });
  it("produces different ciphertext each time (random IV)", async () => {
    const { encryptApiKey } = await import("@/lib/linear-crypto");
    const enc1 = await encryptApiKey("same");
    const enc2 = await encryptApiKey("same");
    expect(enc1).not.toBe(enc2);
  });
});
