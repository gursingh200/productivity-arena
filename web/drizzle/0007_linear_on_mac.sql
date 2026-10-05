-- Linear keys now live only on each Mac. Forget every stored key and connection;
-- people reconnect from the Mac app.
DELETE FROM "linear_accounts";--> statement-breakpoint
ALTER TABLE "linear_accounts" DROP COLUMN "api_key_enc";--> statement-breakpoint
ALTER TABLE "linear_accounts" DROP COLUMN "linear_user_id";--> statement-breakpoint
ALTER TABLE "linear_issues" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "linear_issues" DROP COLUMN "url";
