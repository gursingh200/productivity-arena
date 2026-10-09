import Link from "next/link";
import { CATEGORY_LABEL, type Category } from "@/lib/sharing";
import { firstName } from "./format";

/** Shown in place of a stat the viewer can't see, saying whose choice hid it. */
export function NotShared({ category, reason, name, compact = false }: {
  category: Category;
  reason: "theirs" | "yours" | null;
  name: string;
  compact?: boolean;
}) {
  const label = CATEGORY_LABEL[category].toLowerCase();
  if (reason === "yours") {
    return (
      <p className={compact ? "not-shared compact" : "not-shared"}>
        Share your {label} to see {firstName(name)}’s. <Link href="/settings/sharing">Sharing settings</Link>
      </p>
    );
  }
  return <p className={compact ? "not-shared compact" : "not-shared"}>{firstName(name)} doesn’t share {label}.</p>;
}
