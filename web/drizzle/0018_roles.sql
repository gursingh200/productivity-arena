ALTER TYPE "public"."role" ADD VALUE 'owner';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guild_admin" boolean DEFAULT false NOT NULL;