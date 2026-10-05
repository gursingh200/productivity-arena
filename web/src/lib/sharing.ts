/**
 * Who can see what (spec §7). Give to get: you see a category of someone
 * else's stats only if they share it and you share it too. Nobody is exempt,
 * admins included. You always see your own.
 *
 * Every page and API route that serves another person's stats must go through
 * `visibility` and drop what isn't visible before the data leaves the server.
 */
import type { User } from "@/db/schema";

export const CATEGORIES = ["xp", "human", "agents", "meetings", "apps", "skills"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Visibility = Record<Category, boolean>;

/** The sharing columns of a user row. */
export type Sharer = Pick<User, "id" | "shareXp" | "shareHuman" | "shareAgents" | "shareMeetings" | "shareApps" | "shareSkills">;

export const CATEGORY_LABEL: Record<Category, string> = {
  xp: "XP and level",
  human: "Human hours",
  agents: "Agent hours",
  meetings: "Meeting hours",
  apps: "Apps",
  skills: "Skills",
};

export const CATEGORY_DETAIL: Record<Category, string> = {
  xp: "Your XP, level, league rank, quests and XP history.",
  human: "Your own working time, day by day, and your focus heatmap.",
  agents: "Time your coding agents worked, their tokens and chats.",
  meetings: "Time on calls (Zoom, Slack, Meet, Discord…).",
  apps: "Which apps you spend time in, including call apps.",
  skills: "Your eight-axis skills radar.",
};

export function shares(user: Sharer): Visibility {
  return {
    xp: user.shareXp,
    human: user.shareHuman,
    agents: user.shareAgents,
    meetings: user.shareMeetings,
    apps: user.shareApps,
    skills: user.shareSkills,
  };
}

/** What `viewer` may see of `owner`'s stats. */
export function visibility(viewer: Sharer, owner: Sharer): Visibility {
  if (viewer.id === owner.id) return { xp: true, human: true, agents: true, meetings: true, apps: true, skills: true };
  const theirs = shares(owner);
  const mine = shares(viewer);
  return {
    xp: theirs.xp && mine.xp,
    human: theirs.human && mine.human,
    agents: theirs.agents && mine.agents,
    meetings: theirs.meetings && mine.meetings,
    apps: theirs.apps && mine.apps,
    skills: theirs.skills && mine.skills,
  };
}

/** Why a category is hidden, for the empty state: they don't share it, or you don't. */
export function hiddenReason(viewer: Sharer, owner: Sharer, category: Category): "theirs" | "yours" | null {
  if (visibility(viewer, owner)[category]) return null;
  return shares(owner)[category] ? "yours" : "theirs";
}

/** Column names for updating sharing from a { category: boolean } object. */
export function sharingColumns(choice: Partial<Visibility>): Partial<Omit<Sharer, "id">> {
  const out: Partial<Omit<Sharer, "id">> = {};
  if (choice.xp !== undefined) out.shareXp = choice.xp;
  if (choice.human !== undefined) out.shareHuman = choice.human;
  if (choice.agents !== undefined) out.shareAgents = choice.agents;
  if (choice.meetings !== undefined) out.shareMeetings = choice.meetings;
  if (choice.apps !== undefined) out.shareApps = choice.apps;
  if (choice.skills !== undefined) out.shareSkills = choice.skills;
  return out;
}

/**
 * The categories each skills axis is computed from. A score can be reversed
 * into its inputs (e.g. orchestration × 0.3 = agent-to-human ratio), so an axis
 * shows only if the viewer can also see every category it uses.
 */
export const SKILL_SOURCES = {
  willpower: ["human"],
  consistency: ["human"],
  endurance: ["human"],
  intensity: ["agents"],
  velocity: [],
  competitive: ["xp"],
  camaraderie: ["human", "agents"],
  orchestration: ["human", "agents"],
} as const satisfies Record<string, readonly Category[]>;

/**
 * Which category an XP row reveals. Agent XP is 0.25 per agent-minute, so its
 * amount and reason give away agent time; focus XP gives away human time; a
 * quest gives away what it measured. A viewer sees a row only if they can see
 * its category (and XP).
 */
const QUEST_CATEGORY: Record<string, Category> = {
  stay_longer: "human", deep_block: "human", focus_4h: "human", two_blocks: "human", early_start: "human",
  focus_20h: "human", streak_5: "human", guild_focus_200h: "human",
  parallel_push: "agents", agents_6h: "agents", parallel_3: "agents", agents_40h: "agents", guild_agents_300h: "agents",
  linear_2: "xp", linear_8: "xp", guild_linear_40: "xp",
};

export function xpRowCategory(source: string, questTemplate: string | null): Category {
  if (source === "focus") return "human";
  if (source === "agent" || source === "orchestration") return "agents";
  if (source === "quest") return (questTemplate && QUEST_CATEGORY[questTemplate]) || "agents";
  return "xp";
}
