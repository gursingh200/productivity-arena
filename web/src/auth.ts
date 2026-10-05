import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { accessConfig, devEmailAllowed, googleAllowed } from "@/lib/access";

const access = accessConfig();

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // With a Workspace domain, Google's account chooser only offers that domain.
      ...(access.domain && access.emails.size === 0 ? { authorization: { params: { hd: access.domain } } } : {}),
    }),
    // Dev-only email login (enabled by NODE_ENV=development OR ARENA_DEV_LOGIN=1)
    ...(process.env.NODE_ENV === "development" || process.env.ARENA_DEV_LOGIN === "1"
      ? [
          Credentials({
            id: "dev-email",
            name: "Dev Email",
            credentials: {
              email: { label: "Email", type: "email" },
            },
            async authorize(credentials) {
              const parsed = z.object({ email: z.string().email() }).safeParse(credentials);
              if (!parsed.success) return null;

              const email = parsed.data.email;
              if (!devEmailAllowed(access, email)) return null;

              // Find or create user
              let user = await db.query.users.findFirst({
                where: eq(users.email, email),
              });

              if (!user) {
                const name = email.split("@")[0] ?? email;
                const handle = name.toLowerCase().replace(/[^a-z0-9]/g, "");

                // Check if this is the first user (becomes admin)
                const userCount = await db.select().from(users).limit(1);
                const isFirst = userCount.length === 0;

                const [created] = await db.insert(users).values({
                  email,
                  name,
                  handle: handle || `user_${Date.now()}`,
                  role: isFirst ? "admin" : "member",
                }).returning();
                user = created;
              }

              if (!user) return null;

              return {
                id: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
              };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Google: only verified accounts of the company's Google Workspace. `hd` is
      // the Workspace domain Google vouches for; checking the email suffix alone
      // would let a personal Google account registered with a company address in.
      if (account?.provider === "google") {
        return googleAllowed(access, { email: user.email, ...(profile as { email_verified?: boolean; hd?: string } | undefined) });
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        // Fetch role, handle, guildId on first sign-in and embed in JWT
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, user.id!),
          columns: { role: true, handle: true, guildId: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.handle = dbUser.handle;
          token.guildId = dbUser.guildId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        (session.user as typeof session.user & { role: string; handle: string | null; guildId: string | null }).role = (token.role as string) ?? "member";
        (session.user as typeof session.user & { role: string; handle: string | null; guildId: string | null }).handle = (token.handle as string | null) ?? null;
        (session.user as typeof session.user & { role: string; handle: string | null; guildId: string | null }).guildId = (token.guildId as string | null) ?? null;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // First user becomes admin
      const allUsers = await db.select().from(users);
      if (allUsers.length === 1 && user.id) {
        await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
      }
      // Set handle from email if not set
      if (user.email && user.id) {
        const handle = user.email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? null;
        await db.update(users).set({ handle }).where(eq(users.id, user.id));
      }
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
  },
});
