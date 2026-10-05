CREATE TYPE "public"."quest_kind" AS ENUM('live', 'daily', 'weekly', 'guild');--> statement-breakpoint
CREATE TYPE "public"."quest_state" AS ENUM('offered', 'active', 'completed', 'failed', 'expired', 'declined');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."xp_source" AS ENUM('focus', 'agent', 'orchestration', 'linear', 'quest');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"chat_id" text NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"agent_sec" integer DEFAULT 0 NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_cached" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "chats_device_id_agent_chat_id_pk" PRIMARY KEY("device_id","agent","chat_id")
);
--> statement-breakpoint
CREATE TABLE "daily_rollup" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"human_sec" integer DEFAULT 0 NOT NULL,
	"agent_sec" integer DEFAULT 0 NOT NULL,
	"agent_sec_by_agent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_cached" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	"tokens_by_agent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"peak_parallel" smallint DEFAULT 0 NOT NULL,
	"longest_focus_sec" integer DEFAULT 0 NOT NULL,
	"focus_blocks" smallint DEFAULT 0 NOT NULL,
	"top_apps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_rollup_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"agent_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT '#e8743f' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guilds_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "linear_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"api_key_enc" text NOT NULL,
	"linear_user_id" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "linear_issues" (
	"user_id" uuid NOT NULL,
	"issue_id" text NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"estimate" integer,
	"completed_at" timestamp with time zone,
	"url" text,
	CONSTRAINT "linear_issues_user_id_issue_id_pk" PRIMARY KEY("user_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "minute_agent" (
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"agent" text NOT NULL,
	"sessions" smallint DEFAULT 1 NOT NULL,
	"agent_sec" integer DEFAULT 0 NOT NULL,
	"peak" smallint DEFAULT 1 NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_cached" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "minute_agent_device_id_t_agent_pk" PRIMARY KEY("device_id","t","agent")
);
--> statement-breakpoint
CREATE TABLE "minute_app" (
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"bundle_id" text NOT NULL,
	"app_name" text,
	"active_sec" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "minute_app_device_id_t_bundle_id_pk" PRIMARY KEY("device_id","t","bundle_id")
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guild_id" uuid,
	"kind" "quest_kind" NOT NULL,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"target" integer NOT NULL,
	"unit" text DEFAULT 'sec' NOT NULL,
	"xp" integer NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"state" "quest_state" DEFAULT 'offered' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"handle" text,
	"bio" text,
	"role" "role" DEFAULT 'member' NOT NULL,
	"guild_id" uuid,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"public_apps" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"source" "xp_source" NOT NULL,
	"source_key" text NOT NULL,
	"xp" integer NOT NULL,
	"reason" text NOT NULL,
	"rules_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_user_source_key_unique" UNIQUE("user_id","source","source_key")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rollup" ADD CONSTRAINT "daily_rollup_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_accounts" ADD CONSTRAINT "linear_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_issues" ADD CONSTRAINT "linear_issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_agent" ADD CONSTRAINT "minute_agent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_agent" ADD CONSTRAINT "minute_agent_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_app" ADD CONSTRAINT "minute_app_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_app" ADD CONSTRAINT "minute_app_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_user_idx" ON "chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chats_user_agent_idx" ON "chats" USING btree ("user_id","agent");--> statement-breakpoint
CREATE INDEX "daily_rollup_user_day_idx" ON "daily_rollup" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "linear_issues_user_idx" ON "linear_issues" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "minute_agent_user_t_idx" ON "minute_agent" USING btree ("user_id","t");--> statement-breakpoint
CREATE INDEX "minute_app_user_t_idx" ON "minute_app" USING btree ("user_id","t");--> statement-breakpoint
CREATE INDEX "quests_user_state_idx" ON "quests" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "quests_guild_idx" ON "quests" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "quests_user_kind_idx" ON "quests" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "xp_ledger_user_day_idx" ON "xp_ledger" USING btree ("user_id","day");