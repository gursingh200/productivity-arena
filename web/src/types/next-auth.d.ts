import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      handle: string | null;
      guildId: string | null;
    } & DefaultSession["user"];
  }
}
