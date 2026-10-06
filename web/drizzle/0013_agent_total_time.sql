ALTER TABLE "daily_rollup" ADD COLUMN "agent_work_sec" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_rollup" ADD COLUMN "peak_threads" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "minute_agent" ADD COLUMN "work_sec" integer;--> statement-breakpoint
ALTER TABLE "minute_agent" ADD COLUMN "threads" smallint;
--> statement-breakpoint
-- Days before total time was tracked: total = clock time, threads = parallel chats.
UPDATE "daily_rollup" SET "agent_work_sec" = "agent_sec", "peak_threads" = "peak_parallel";
