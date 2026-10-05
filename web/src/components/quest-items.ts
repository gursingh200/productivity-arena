/** Plain quest data passed from server pages to the client QuestList. */
export interface QuestItem {
  id: string;
  kind: string;
  title: string;
  xp: number;
  progress: number;
  target: number;
  unit: string;
  state: string;
  windowEnd: string | null;
}

export function toQuestItems(quests: Array<{ id: string; kind: string; title: string; xp: number; progress: number; target: number; unit: string; state: string; windowEnd: Date | null }>): QuestItem[] {
  return quests.map((q) => ({ id: q.id, kind: q.kind, title: q.title, xp: q.xp, progress: q.progress, target: q.target, unit: q.unit, state: q.state, windowEnd: q.windowEnd?.toISOString() ?? null }));
}
