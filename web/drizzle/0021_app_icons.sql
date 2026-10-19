CREATE TABLE "app_icons" (
	"bundle_id" text PRIMARY KEY NOT NULL,
	"png" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
