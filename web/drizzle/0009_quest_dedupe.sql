-- Daily and weekly quests could be created twice: by two uploads at once (same
-- window) or after a timezone change (windows less than half a window apart). Keep the earliest of
-- each and drop open duplicates. XP already awarded stays.
DELETE FROM "quests" q USING "quests" k
  WHERE q.user_id = k.user_id AND q.template = k.template AND q.window_start = k.window_start
    AND (k.created_at, k.id) < (q.created_at, q.id);--> statement-breakpoint
DELETE FROM "quests" q USING "quests" k
  WHERE q.kind IN ('daily', 'weekly') AND q.state = 'active'
    AND q.user_id = k.user_id AND q.template = k.template AND q.kind = k.kind
    AND abs(extract(epoch FROM k.window_start - q.window_start)) * 2 < extract(epoch FROM q.window_end - q.window_start)
    AND (k.created_at, k.id) < (q.created_at, q.id);--> statement-breakpoint
CREATE UNIQUE INDEX "quests_user_template_window_idx" ON "quests" USING btree ("user_id","template","window_start");
