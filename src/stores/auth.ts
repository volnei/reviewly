import type { Viewer } from "@/lib/tauri";
import { create } from "zustand";

interface AuthState {
  loading: boolean;
  signedIn: boolean;
  viewer: Viewer | null;
  set: (next: Partial<Pick<AuthState, "loading" | "signedIn" | "viewer">>) => void;
}

export const useAuth = create<AuthState>((set) => ({
  loading: true,
  signedIn: false,
  viewer: null,
  set: (next) => set(next),
}));
