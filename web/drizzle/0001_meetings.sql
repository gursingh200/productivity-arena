CREATE TABLE "minute_meeting" (
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"bundle_id" text NOT NULL,
	"app_name" text,
	"sec" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "minute_meeting_device_id_t_bundle_id_pk" PRIMARY KEY("device_id","t","bundle_id")
);
--> statement-breakpoint
ALTER TABLE "daily_rollup" ADD COLUMN "meeting_sec" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "minute_meeting" ADD CONSTRAINT "minute_meeting_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_meeting" ADD CONSTRAINT "minute_meeting_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "minute_meeting_user_t_idx" ON "minute_meeting" USING btree ("user_id","t");