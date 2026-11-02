import { describe, expect, it } from "bun:test";
import { MODEL_SUGGESTIONS, PROVIDERS, providerName } from "../src/effect/services/Ai";
import { Prefs } from "../src/effect/services/Prefs";
import { Schema } from "effect";

describe("AI Providers registry & compatibility", () => {
  it("includes all supported providers including Antigravity and Gemini", () => {
    const keys = PROVIDERS.map(([k]) => k);
    expect(keys).toContain("claude");
    expect(keys).toContain("codex");
    expect(keys).toContain("agy");
    expect(keys).toContain("gemini");
    expect(keys).toContain("openai");
  });

  it("formats short names correctly for both agy and gemini", () => {
    expect(providerName("agy")).toBe("Antigravity");
    expect(providerName("gemini")).toBe("Gemini");
  });

  it("suggests distinct models for agy and gemini", () => {
    expect(MODEL_SUGGESTIONS.agy).toContain("gemini-3.8-flash-high");
    expect(MODEL_SUGGESTIONS.gemini).toContain("gemini-2.5-pro");
  });

  it("preserves stored Gemini preferences without silent migration", () => {
    const decoded = Schema.decodeUnknownSync(Prefs.fields.ai)({
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "",
      baseUrl: "",
      timeoutSecs: 0,
      instructions: "",
      preread: true,
      autoTour: false,
      suggestionAction: "draft",
    });
    expect(decoded.provider).toBe("gemini");
  });

  it("decodes stored Antigravity preferences cleanly", () => {
    const decoded = Schema.decodeUnknownSync(Prefs.fields.ai)({
      provider: "agy",
      model: "gemini-3.8-flash-high",
      apiKey: "",
      baseUrl: "",
      timeoutSecs: 0,
      instructions: "",
      preread: true,
      autoTour: false,
      suggestionAction: "draft",
    });
    expect(decoded.provider).toBe("agy");
  });
});
