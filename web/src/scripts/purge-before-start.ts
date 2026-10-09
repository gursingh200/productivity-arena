/** Run after migrations on every deploy: deletes data from before ARENA_START_DATE and moves accounts still on the UTC default to the company timezone. */
import { purgeBeforeStart } from "@/lib/start-date";
import { db, users } from "@/db";
import { evaluateAchievements } from "@/lib/achievements";
import { adoptCompanyTimezone } from "@/lib/user-timezone";

purgeBeforeStart()
  .then(async ({ startDay }) => {
    console.log(startDay ? `Counting from ${startDay}; older data removed.` : "No ARENA_START_DATE set; nothing removed.");
    const moved = await adoptCompanyTimezone();
    if (moved) console.log(`${moved} account(s) moved from UTC to the company timezone.`);
    // Achievements for what already happened (new achievements on older data).
    let unlocked = 0;
    const everyone = await db.select({ id: users.id }).from(users);
    for (let i = 0; i < everyone.length; i += 5) {
      const batch = await Promise.all(everyone.slice(i, i + 5).map((u) => evaluateAchievements(u.id)));
      unlocked += batch.reduce((s, b) => s + b.length, 0);
    }
    if (unlocked) console.log(`${unlocked} achievement(s) unlocked from past data.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
