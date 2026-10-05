/** Run after migrations on every deploy: deletes data from before ARENA_START_DATE. */
import { purgeBeforeStart } from "@/lib/start-date";

purgeBeforeStart()
  .then(({ startDay }) => {
    console.log(startDay ? `Counting from ${startDay}; older data removed.` : "No ARENA_START_DATE set; nothing removed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
