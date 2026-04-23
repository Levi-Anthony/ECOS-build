import { describe, it, expect } from "vitest";
import { aggregateObsCounts, aggregateLastService, aggregateUnbilled } from "@/lib/logic";

// ─── aggregateObsCounts ───────────────────────────────────────────────────────

describe("aggregateObsCounts", () => {
  it("returns empty object for empty input", () => {
    expect(aggregateObsCounts([])).toEqual({});
  });

  it("counts a single row correctly", () => {
    const rows = [{ contact_id: "abc" }];
    expect(aggregateObsCounts(rows)).toEqual({ abc: 1 });
  });

  it("counts multiple rows for the same contact", () => {
    const rows = [
      { contact_id: "abc" },
      { contact_id: "abc" },
      { contact_id: "abc" },
    ];
    expect(aggregateObsCounts(rows)).toEqual({ abc: 3 });
  });

  it("counts multiple contacts independently", () => {
    const rows = [
      { contact_id: "a" },
      { contact_id: "b" },
      { contact_id: "a" },
      { contact_id: "c" },
      { contact_id: "b" },
      { contact_id: "b" },
    ];
    const result = aggregateObsCounts(rows);
    expect(result).toEqual({ a: 2, b: 3, c: 1 });
  });

  it("does not mutate the input array", () => {
    const rows = [{ contact_id: "x" }];
    const copy = [...rows];
    aggregateObsCounts(rows);
    expect(rows).toEqual(copy);
  });
});

// ─── aggregateLastService ─────────────────────────────────────────────────────

describe("aggregateLastService", () => {
  it("returns empty object for empty input", () => {
    expect(aggregateLastService([])).toEqual({});
  });

  it("returns the first row's date (expects pre-sorted DESC input)", () => {
    const rows = [
      { contact_id: "abc", service_date: "2026-04-20" },
      { contact_id: "abc", service_date: "2026-03-15" },
      { contact_id: "abc", service_date: "2026-02-01" },
    ];
    expect(aggregateLastService(rows)).toEqual({ abc: "2026-04-20" });
  });

  it("handles multiple contacts", () => {
    const rows = [
      { contact_id: "a", service_date: "2026-04-20" },
      { contact_id: "b", service_date: "2026-04-18" },
      { contact_id: "a", service_date: "2026-03-01" },
    ];
    const result = aggregateLastService(rows);
    expect(result.a).toBe("2026-04-20");
    expect(result.b).toBe("2026-04-18");
  });

  it("single row per contact", () => {
    const rows = [{ contact_id: "solo", service_date: "2026-01-15" }];
    expect(aggregateLastService(rows)).toEqual({ solo: "2026-01-15" });
  });
});

// ─── aggregateUnbilled ────────────────────────────────────────────────────────

describe("aggregateUnbilled", () => {
  it("returns empty object for empty input", () => {
    expect(aggregateUnbilled([])).toEqual({});
  });

  it("counts and sums correctly for one contact", () => {
    const rows = [
      { contact_id: "a", time_spent_minutes: 60 },
      { contact_id: "a", time_spent_minutes: 90 },
    ];
    expect(aggregateUnbilled(rows)).toEqual({
      a: { count: 2, totalMin: 150 },
    });
  });

  it("treats null time_spent_minutes as 0", () => {
    const rows = [
      { contact_id: "a", time_spent_minutes: null },
      { contact_id: "a", time_spent_minutes: 30 },
    ];
    expect(aggregateUnbilled(rows)).toEqual({
      a: { count: 2, totalMin: 30 },
    });
  });

  it("treats undefined time_spent_minutes as 0 (ServiceLog optional field)", () => {
    const rows = [
      { contact_id: "a", time_spent_minutes: undefined },
      { contact_id: "a", time_spent_minutes: 45 },
    ];
    expect(aggregateUnbilled(rows)).toEqual({
      a: { count: 2, totalMin: 45 },
    });
  });

  it("treats missing time_spent_minutes key as 0", () => {
    const rows = [
      { contact_id: "a" },
      { contact_id: "a", time_spent_minutes: 60 },
    ];
    expect(aggregateUnbilled(rows)).toEqual({
      a: { count: 2, totalMin: 60 },
    });
  });

  it("all-null minutes produces totalMin of 0", () => {
    const rows = [
      { contact_id: "x", time_spent_minutes: null },
      { contact_id: "x", time_spent_minutes: null },
    ];
    expect(aggregateUnbilled(rows)["x"]).toEqual({ count: 2, totalMin: 0 });
  });

  it("handles multiple contacts independently", () => {
    const rows = [
      { contact_id: "a", time_spent_minutes: 60 },
      { contact_id: "b", time_spent_minutes: 120 },
      { contact_id: "a", time_spent_minutes: 45 },
    ];
    const result = aggregateUnbilled(rows);
    expect(result.a).toEqual({ count: 2, totalMin: 105 });
    expect(result.b).toEqual({ count: 1, totalMin: 120 });
  });

  it("a contact absent from input has no entry", () => {
    const result = aggregateUnbilled([{ contact_id: "a", time_spent_minutes: 10 }]);
    expect(result["z"]).toBeUndefined();
  });
});
