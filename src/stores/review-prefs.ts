import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface State {
  /** Mark a file as viewed automatically once you scroll past the end of its diff. */
  autoMarkViewed: boolean;
  setAutoMarkViewed: (v: boolean) => void;
  /** Custom guidance prepended to every AI review/chat prompt. */
  aiInstructions: string;
  setAiInstructions: (v: string) => void;
  /** Auto-convert a draft PR to ready-for-review when you submit a review. */
  autoReadyOnReview: boolean;
  setAutoReadyOnReview: (v: boolean) => void;
  /** Diff line-height — "comfortable" (default) or "compact". */
  diffDensity: "comfortable" | "compact";
  setDiffDensity: (v: "comfortable" | "compact") => void;
  /** Wrap long diff lines instead of letting them overflow horizontally. */
  diffWrap: boolean;
  setDiffWrap: (v: boolean) => void;
  /** Collapse del/add pairs that differ only by whitespace. */
  hideWhitespace: boolean;
  setHideWhitespace: (v: boolean) => void;
}

export const useReviewPrefs = create<State>()(
  persist(
    (set) => ({
      autoMarkViewed: false,
      setAutoMarkViewed: (autoMarkViewed) => set({ autoMarkViewed }),
      aiInstructions: "",
      setAiInstructions: (aiInstructions) => set({ aiInstructions }),
      autoReadyOnReview: false,
      setAutoReadyOnReview: (autoReadyOnReview) => set({ autoReadyOnReview }),
      diffDensity: "comfortable",
      setDiffDensity: (diffDensity) => set({ diffDensity }),
      diffWrap: true,
      setDiffWrap: (diffWrap) => set({ diffWrap }),
      hideWhitespace: false,
      setHideWhitespace: (hideWhitespace) => set({ hideWhitespace }),
    }),
    { name: "reviewly.review-prefs", storage: sqlStorage<State>() },
  ),
);
