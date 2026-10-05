CREATE TABLE "leaderboard_history" (
	"period" text NOT NULL,
	"period_start" text NOT NULL,
	"board" text NOT NULL,
	"league" text NOT NULL,
	"rank" smallint NOT NULL,
	"user_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "leaderboard_history_period_period_start_board_league_user_id_pk" PRIMARY KEY("period","period_start","board","league","user_id")
);
--> statement-breakpoint
CREATE TABLE "period_totals" (
	"period" text NOT NULL,
	"period_start" text NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"xp_people" smallint DEFAULT 0 NOT NULL,
	"human_sec" bigint DEFAULT 0 NOT NULL,
	"human_people" smallint DEFAULT 0 NOT NULL,
	"agent_sec" bigint DEFAULT 0 NOT NULL,
	"agent_people" smallint DEFAULT 0 NOT NULL,
	"meeting_sec" bigint DEFAULT 0 NOT NULL,
	"meeting_people" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_totals_period_period_start_pk" PRIMARY KEY("period","period_start")
);
--> statement-breakpoint
ALTER TABLE "leaderboard_history" ADD CONSTRAINT "leaderboard_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leaderboard_history_lookup_idx" ON "leaderboard_history" USING btree ("period","board","league","period_start");