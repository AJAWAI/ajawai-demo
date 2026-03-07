import { afterEach, describe, expect, it } from "vitest";
import { syncWithSupabase } from "./supabaseSync";

describe("supabase sync resilience", () => {
  const originalOnline = navigator.onLine;

  afterEach(() => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: originalOnline
    });
  });

  it("returns offline_cache_only instead of throwing when offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false
    });
    const result = await syncWithSupabase("user-123");
    expect(result.state).toBe("offline_cache_only");
    expect(result.synced).toBe(false);
  });
});
