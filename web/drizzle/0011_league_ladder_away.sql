CREATE TABLE "away_days" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	CONSTRAINT "away_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "league_weeks" (
	"user_id" uuid NOT NULL,
	"week_start" text NOT NULL,
	"league" text NOT NULL,
	"move" text NOT NULL,
	CONSTRAINT "league_weeks_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "away_days" ADD CONSTRAINT "away_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_weeks" ADD CONSTRAINT "league_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "away_days_day_idx" ON "away_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "league_weeks_week_idx" ON "league_weeks" USING btree ("week_start");