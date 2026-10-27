import { persistedStore, useStore } from "@/effect/store";

const categories = [
  "general",
  "appearance",
  "repositories",
  "review",
  "assistant",
  "notifications",
  "account",
  "about",
] as const;
export type SettingsCategory = (typeof categories)[number];
export const settingsCategoryStore = persistedStore<SettingsCategory>(
  "reviewly.v2.settings-category",
  "general",
  (raw) => (categories.includes(raw as SettingsCategory) ? (raw as SettingsCategory) : "general"),
);
export const useSettingsCategory = () => useStore(settingsCategoryStore);
