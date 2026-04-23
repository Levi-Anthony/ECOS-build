import { describe, it, expect } from "vitest";
import { computeIntelStatus, computeStaleness, type ObsAgg, type SnapInfo } from "@/lib/logic";

// Pin reference date
const REF = new Date("2026-04-23T12:00:00Z");

function daysAgo(n: number): string {
  const d = new Date(REF.getTime() - n * 86400000);
  return d.toISOString();
}

const SAMPLE_OBS: ObsAgg = {
  total: 10,
  lastObserved: daysAgo(2),
  facts: 4,
  interpretations: 3,
  strategies: 3,
};

function snap(daysOld: number, obsAtCompile: number): SnapInfo {
  return { version: 1, created_at: daysAgo(daysOld), obsAtCompile };
}

// ─── computeStaleness ─────────────────────────────────────────────────────────

describe("computeStaleness", () => {
  it("is not stale when recent and no new obs", () => {
    const result = computeStaleness(snap(5, 10), 10, REF);
    expect(result.stale).toBe(false);
    expect(result.daysSince).toBe(5);
    expect(result.newObsSince).toBe(0);
  });

  it("is stale when >30 days old regardless of new obs", () => {
    const result = computeStaleness(snap(31, 10), 10, REF);
    expect(result.stale).toBe(true);
    expect(result.daysSince).toBe(31);
  });

  it("is not stale at exactly 30 days (threshold is strictly >30)", () => {
    const result = computeStaleness(snap(30, 10), 10, REF);
    expect(result.stale).toBe(false);
  });

  it("is stale when ≥5 new observations since compile", () => {
    const result = computeStaleness(snap(10, 5), 10, REF);
    expect(result.newObsSince).toBe(5);
    expect(result.stale).toBe(true);
  });

  it("is not stale with exactly 4 new observations (threshold is ≥5)", () => {
    const result = computeStaleness(snap(10, 6), 10, REF);
    expect(result.newObsSince).toBe(4);
    expect(result.stale).toBe(false);
  });

  it("is stale when both age and new obs exceed thresholds", () => {
    const result = computeStaleness(snap(45, 2), 10, REF);
    expect(result.stale).toBe(true);
    expect(result.daysSince).toBe(45);
    expect(result.newObsSince).toBe(8);
  });

  it("reports correct newObsSince when obsAtCompile is higher than current (shouldn't happen, but safe)", () => {
    const result = computeStaleness(snap(5, 20), 10, REF);
    expect(result.newObsSince).toBe(-10);
    expect(result.stale).toBe(false);
  });
});

// ─── computeIntelStatus ───────────────────────────────────────────────────────

describe("computeIntelStatus", () => {
  it("returns 'unseeded' when obs is null", () => {
    expect(computeIntelStatus(null, null, REF)).toBe("unseeded");
  });

  it("returns 'unseeded' when obs is undefined", () => {
    expect(computeIntelStatus(undefined, undefined, REF)).toBe("unseeded");
  });

  it("returns 'needs_snap' when obs exists but snap is null", () => {
    expect(computeIntelStatus(SAMPLE_OBS, null, REF)).toBe("needs_snap");
  });

  it("returns 'needs_snap' when obs exists but snap is undefined", () => {
    expect(computeIntelStatus(SAMPLE_OBS, undefined, REF)).toBe("needs_snap");
  });

  it("returns 'current' when snap is recent and no new obs", () => {
    expect(computeIntelStatus(SAMPLE_OBS, snap(5, 10), REF)).toBe("current");
  });

  it("returns 'stale' when snap is >30 days old", () => {
    expect(computeIntelStatus(SAMPLE_OBS, snap(31, 10), REF)).toBe("stale");
  });

  it("returns 'stale' when ≥5 new observations since compile", () => {
    const obsWithMore: ObsAgg = { ...SAMPLE_OBS, total: 15 };
    expect(computeIntelStatus(obsWithMore, snap(5, 10), REF)).toBe("stale");
  });

  it("returns 'current' at exactly 30 days old with 4 new obs", () => {
    const obsWithFour: ObsAgg = { ...SAMPLE_OBS, total: 14 };
    expect(computeIntelStatus(obsWithFour, snap(30, 10), REF)).toBe("current");
  });

  it("transitions correctly: 30d → current, 31d → stale", () => {
    expect(computeIntelStatus(SAMPLE_OBS, snap(30, 10), REF)).toBe("current");
    expect(computeIntelStatus(SAMPLE_OBS, snap(31, 10), REF)).toBe("stale");
  });

  it("transitions correctly: 4 new obs → current, 5 new obs → stale", () => {
    const obs4: ObsAgg = { ...SAMPLE_OBS, total: 14 }; // 14 - 10 = 4
    const obs5: ObsAgg = { ...SAMPLE_OBS, total: 15 }; // 15 - 10 = 5
    expect(computeIntelStatus(obs4, snap(5, 10), REF)).toBe("current");
    expect(computeIntelStatus(obs5, snap(5, 10), REF)).toBe("stale");
  });
});
