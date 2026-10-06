import { z } from "zod";

const AppEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable().optional(),
  sec: z.number().int().min(0).max(60),
});

const AgentEntrySchema = z.object({
  agent: z.string().min(1),
  sec: z.number().int().min(0),
  sessions: z.number().int().min(0).default(1),
  peak: z.number().int().min(0).default(1),
  tokensIn: z.number().int().min(0).default(0),
  tokensCached: z.number().int().min(0).default(0),
  tokensOut: z.number().int().min(0).default(0),
});

/** Seconds a call app held the microphone in the minute. */
const MeetingEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable().optional(),
  sec: z.number().int().min(0).max(60),
});

const MinuteSchema = z.object({
  t: z.string().datetime(),
  apps: z.array(AppEntrySchema).default([]),
  agents: z.array(AgentEntrySchema).default([]),
  meetings: z.array(MeetingEntrySchema).default([]),
});

const ChatEntrySchema = z.object({
  agent: z.string().min(1),
  chatId: z.string().regex(/^[0-9a-f]{16}$/),
  firstAt: z.string().datetime(),
  lastAt: z.string().datetime(),
  agentSec: z.number().int().min(0),
  turns: z.number().int().min(0),
  tokensIn: z.number().int().min(0).default(0),
  tokensCached: z.number().int().min(0).default(0),
  tokensOut: z.number().int().min(0).default(0),
});

export const IngestPayloadSchema = z.object({
  schema: z.literal(1),
  device: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    os: z.string().optional(),
    agentVersion: z.string().optional(),
    /** The Mac's IANA timezone, e.g. "Asia/Kolkata"; the person's days follow it. */
    timezone: z.string().max(64).optional(),
  }),
  minutes: z.array(MinuteSchema),
  chats: z.array(ChatEntrySchema).optional().default([]),
  /** Chats the device no longer has (e.g. sub-agent sessions merged into their parent). */
  deletedChats: z.array(z.string().regex(/^[0-9a-f]{16}$/)).optional().default([]),
});

export const MAX_MINUTES = 1440;
export const MAX_CHATS = 2000;

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
export type MinuteEntry = z.infer<typeof MinuteSchema>;
export type AgentEntry = z.infer<typeof AgentEntrySchema>;
export type AppEntry = z.infer<typeof AppEntrySchema>;
export type MeetingEntry = z.infer<typeof MeetingEntrySchema>;
export type ChatEntry = z.infer<typeof ChatEntrySchema>;
