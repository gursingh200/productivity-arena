import { describe, it, expect } from "vitest";
import { IngestPayloadSchema } from "@/lib/ingest-schema";

function makeChat(i: number) {
  return {
    agent: "claude",
    chatId: i.toString(16).padStart(16, "0"),
    firstAt: new Date().toISOString(),
    lastAt: new Date().toISOString(),
    agentSec: 60,
    turns: 5,
    tokensIn: 100,
    tokensCached: 50,
    tokensOut: 200,
  };
}

const basePayload = {
  schema: 1 as const,
  device: { id: "00000000-0000-0000-0000-000000000001", name: "test" },
  minutes: [],
};

describe("IngestPayloadSchema chats", () => {
  it("accepts 0 chats (chats omitted)", () => {
    const result = IngestPayloadSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
  });
  it("accepts exactly 2000 chats", () => {
    const result = IngestPayloadSchema.safeParse({
      ...basePayload,
      chats: Array.from({ length: 2000 }, (_, i) => makeChat(i)),
    });
    expect(result.success).toBe(true);
  });
  it("rejects invalid chatId (not 16 hex chars)", () => {
    const result = IngestPayloadSchema.safeParse({
      ...basePayload,
      chats: [{ ...makeChat(0), chatId: "nothex" }],
    });
    expect(result.success).toBe(false);
  });
  it("accepts 1440 minutes", () => {
    const mins = Array.from({ length: 1440 }, (_, i) => ({
      t: new Date(Date.now() - i * 60000).toISOString(),
      apps: [],
      agents: [],
    }));
    const result = IngestPayloadSchema.safeParse({ ...basePayload, minutes: mins });
    expect(result.success).toBe(true);
  });
});
