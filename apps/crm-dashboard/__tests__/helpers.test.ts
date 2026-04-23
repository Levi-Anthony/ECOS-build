import { describe, it, expect } from "vitest";
import {
  isOverdue,
  isFollowUpSoon,
  relativeAge,
  formatTime,
  formatDayLabel,
  weekLabel,
  coldContactThreshold,
} from "@/lib/logic";

// Pin a reference date for all deterministic tests: 2026-04-23T12:00:00Z (noon UTC)
const REF = new Date("2026-04-23T12:00:00Z");

// ─── isOverdue ────────────────────────────────────────────────────────────────

describe("isOverdue", () => {
  it("returns false for null", () => {
    expect(isOverdue(null, REF)).toBe(false);
  });

  it("returns false for a future date", () => {
    expect(isOverdue("2026-04-30", REF)).toBe(false);
  });

  it("returns true for a past date", () => {
    expect(isOverdue("2026-04-01", REF)).toBe(true);
  });

  it("returns true for yesterday", () => {
    expect(isOverdue("2026-04-22", REF)).toBe(true);
  });

  // A date string at midnight is before noon — counts as overdue.
  it("returns true for today at midnight when ref is noon", () => {
    expect(isOverdue("2026-04-23", REF)).toBe(true);
  });
});

// ─── isFollowUpSoon ───────────────────────────────────────────────────────────

describe("isFollowUpSoon", () => {
  it("returns false for null", () => {
    expect(isFollowUpSoon(null, REF)).toBe(false);
  });

  it("returns false for a date 8 days out", () => {
    expect(isFollowUpSoon("2026-05-01", REF)).toBe(false);
  });

  it("returns true for a date exactly 7 days out", () => {
    expect(isFollowUpSoon("2026-04-30", REF)).toBe(true);
  });

  it("returns true for a date 3 days out", () => {
    expect(isFollowUpSoon("2026-04-26", REF)).toBe(true);
  });

  it("returns true for an overdue date (follow-up is also 'soon')", () => {
    expect(isFollowUpSoon("2026-04-10", REF)).toBe(true);
  });
});

// ─── relativeAge ──────────────────────────────────────────────────────────────

describe("relativeAge", () => {
  it("returns 'just now' for 30 minutes ago", () => {
    const ts = new Date(REF.getTime() - 30 * 60 * 1000).toISOString();
    expect(relativeAge(ts, REF)).toBe("just now");
  });

  it("returns 'just now' for exactly 0 ms ago", () => {
    expect(relativeAge(REF.toISOString(), REF)).toBe("just now");
  });

  it("returns hours for 3 hours ago", () => {
    const ts = new Date(REF.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeAge(ts, REF)).toBe("3h ago");
  });

  it("returns hours for exactly 1 hour ago", () => {
    const ts = new Date(REF.getTime() - 60 * 60 * 1000).toISOString();
    expect(relativeAge(ts, REF)).toBe("1h ago");
  });

  it("returns days for 2 days ago", () => {
    const ts = new Date(REF.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeAge(ts, REF)).toBe("2d ago");
  });

  it("returns days for 30 days ago", () => {
    const ts = new Date(REF.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeAge(ts, REF)).toBe("30d ago");
  });

  it("boundary: 23h 59m ago is still hours", () => {
    const ts = new Date(REF.getTime() - (24 * 60 - 1) * 60 * 1000).toISOString();
    expect(relativeAge(ts, REF)).toBe("23h ago");
  });
});

// ─── formatTime ───────────────────────────────────────────────────────────────

describe("formatTime (MST = UTC-7)", () => {
  it("converts 14:00 UTC to 07:00 MST", () => {
    expect(formatTime("2026-04-23T14:00:00Z")).toBe("07:00");
  });

  it("converts midnight UTC to 17:00 MST previous day", () => {
    expect(formatTime("2026-04-23T00:00:00Z")).toBe("17:00");
  });

  it("converts 07:30 UTC to 00:30 MST", () => {
    expect(formatTime("2026-04-23T07:30:00Z")).toBe("00:30");
  });

  it("returns HH:MM format (zero-padded)", () => {
    const result = formatTime("2026-04-23T08:05:00Z");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ─── formatDayLabel ───────────────────────────────────────────────────────────

describe("formatDayLabel", () => {
  it("formats a known date correctly", () => {
    // 2026-04-23 is a Thursday
    const label = formatDayLabel("2026-04-23");
    expect(label).toContain("Apr");
    expect(label).toContain("23");
    expect(label).toContain("Thu");
  });

  it("formats first of month correctly", () => {
    const label = formatDayLabel("2026-01-01");
    expect(label).toContain("Jan");
    expect(label).toContain("1");
  });
});

// ─── weekLabel ────────────────────────────────────────────────────────────────

describe("weekLabel", () => {
  it("returns a string with an en-dash separator", () => {
    expect(weekLabel(REF)).toContain("–");
  });

  it("starts 6 days before the reference date", () => {
    // REF = Apr 23 → start = Apr 17
    const label = weekLabel(REF);
    expect(label).toContain("Apr 17");
    expect(label).toContain("Apr 23");
  });
});

// ─── coldContactThreshold ────────────────────────────────────────────────────

describe("coldContactThreshold", () => {
  it("returns YYYY-MM-DD format", () => {
    const result = coldContactThreshold(60, REF);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("subtracts exactly N days", () => {
    // REF = 2026-04-23, minus 60 days = 2026-02-22
    expect(coldContactThreshold(60, REF)).toBe("2026-02-22");
  });

  it("works for 0 days (today)", () => {
    expect(coldContactThreshold(0, REF)).toBe("2026-04-23");
  });

  it("works for 1 day", () => {
    expect(coldContactThreshold(1, REF)).toBe("2026-04-22");
  });
});
