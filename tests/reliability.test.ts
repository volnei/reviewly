import { describe, expect, test } from "bun:test";
import {
  aiCanRetryAutomatically,
  classifyFailure,
  failureText,
  recoveryHint,
  retryDelay,
  retryLimit,
  shouldRetry,
} from "../src/lib/reliability";

describe("reliability policy", () => {
  test("classifies failures that must not be retried", () => {
    expect(classifyFailure("upstream github returned 401")).toBe("auth");
    expect(classifyFailure("403 missing workflow permission")).toBe("permission");
    expect(classifyFailure("404 not found")).toBe("not-found");
    expect(classifyFailure("422 validation failed")).toBe("validation");
    expect(classifyFailure("Canceled")).toBe("canceled");
    expect(retryLimit("401 unauthorized")).toBe(0);
  });

  test("retries transient failures with a bounded budget", () => {
    expect(retryLimit("429 rate limit")).toBe(4);
    expect(retryLimit("503 service unavailable")).toBe(3);
    expect(retryLimit("network connection reset")).toBe(3);
    expect(shouldRetry(2, "503 service unavailable")).toBe(true);
    expect(shouldRetry(3, "503 service unavailable")).toBe(false);
  });

  test("treats a silent AI stream as a timeout", () => {
    expect(classifyFailure("Claude produced no activity for 180s")).toBe(
      "timeout",
    );
  });

  test("honors an explicit retry-after without waiting forever", () => {
    expect(retryDelay(0, "429; Retry-After: 12")).toBe(12_000);
    expect(retryDelay(0, "Retry-After: 999")).toBe(60_000);
    expect(retryDelay(1, "503")).toBeGreaterThan(1_000);
  });

  test("cleans transport wrappers and gives an actionable recovery", () => {
    expect(failureText(new Error("AiError: timed out"))).toBe("timed out");
    expect(recoveryHint("network connection reset")).toContain("cached data");
    expect(recoveryHint("401 unauthorized")).toContain("Sign in again");
  });

  test("only automatically retries AI before any partial answer", () => {
    expect(aiCanRetryAutomatically("network connection reset", 0)).toBe(true);
    expect(aiCanRetryAutomatically("network connection reset", 12)).toBe(false);
    expect(aiCanRetryAutomatically("401 unauthorized", 0)).toBe(false);
  });
});
