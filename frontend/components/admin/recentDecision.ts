// The decision just made on one paper, kept for the next paper's screen so it
// can say "Saved" and offer to change it. The review page swaps papers without
// reloading, so a module variable is enough; a reload simply drops it.
import type { Decision } from "@/lib/adminTypes";

export interface RecentDecision {
  // The paper that was decided.
  id: string;
  title: string;
  decision: Decision;
  // The paper the reviewer moved on to. Only its screen shows the banner.
  nextId: string;
}

let recent: RecentDecision | null = null;

export function rememberDecision(decision: RecentDecision): void {
  recent = decision;
}

// The decision made just before opening this paper, if it was.
export function decisionBefore(paperId: string): RecentDecision | null {
  if (recent !== null && recent.nextId === paperId) {
    return recent;
  }
  return null;
}
