import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

interface ReviewVerdictState {
  /** The verdict the viewer last submitted — pre-selected next time. */
  last: ReviewEvent;
  setLast: (v: ReviewEvent) => void;
}

/**
 * Remembers the last-used review verdict so the submit popover opens on the
 * viewer's usual choice instead of always starting at "Comment".
 */
export const useReviewVerdict = create<ReviewVerdictState>()(
  persist(
    (set) => ({
      last: "COMMENT",
      setLast: (last) => set({ last }),
    }),
    { name: "reviewly.review-verdict", storage: sqlStorage<ReviewVerdictState>() },
  ),
);
