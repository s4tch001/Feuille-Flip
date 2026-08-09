import { describe, expect, it, vi } from "vitest";

import {
  addCalendarMonthsUtc,
  cleanupExpiredFlipbooks,
  getFlipbookExpiry,
  getFlipbookStoragePaths,
  isFlipbookExpired,
  type RetentionFlipbookRow,
} from "@/lib/flipbook-retention";

function row(overrides: Partial<RetentionFlipbookRow> = {}): RetentionFlipbookRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    created_at: "2026-07-15T08:30:45.123Z",
    storage_path: "uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf",
    page_paths: null,
    ...overrides,
  };
}

describe("flipbook calendar-month retention", () => {
  it("expires the requested July example at the same UTC instant in October", () => {
    expect(getFlipbookExpiry("2026-07-15T08:30:45.123Z").toISOString())
      .toBe("2026-10-15T08:30:45.123Z");
  });

  it("clamps a month-end date to the target month's final day", () => {
    expect(addCalendarMonthsUtc("2026-01-31T23:59:59.000Z", 3).toISOString())
      .toBe("2026-04-30T23:59:59.000Z");
  });

  it("handles a leap-year February without changing the time of day", () => {
    expect(addCalendarMonthsUtc("2023-11-30T06:15:00.250Z", 3).toISOString())
      .toBe("2024-02-29T06:15:00.250Z");
  });

  it("stays available immediately before expiry and expires at the exact boundary", () => {
    const publishedAt = "2026-07-15T08:30:45.123Z";
    expect(isFlipbookExpired(publishedAt, new Date("2026-10-15T08:30:45.122Z"))).toBe(false);
    expect(isFlipbookExpired(publishedAt, new Date("2026-10-15T08:30:45.123Z"))).toBe(true);
  });
});

describe("flipbook retention cleanup", () => {
  it("accepts only one validated PDF path or a single WebP page prefix", () => {
    expect(getFlipbookStoragePaths(row())).toEqual([
      "uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf",
    ]);
    expect(getFlipbookStoragePaths(row({
      storage_path: null,
      page_paths: [
        "pages/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/0001.webp",
        "pages/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/0002.webp",
      ],
    }))).toHaveLength(2);
    expect(() => getFlipbookStoragePaths(row({
      storage_path: null,
      page_paths: ["pages/../../another-bucket/file.webp"],
    }))).toThrow("invalid page path");
  });

  it("deletes Storage before the row and skips unexpired records", async () => {
    const calls: string[] = [];
    const summary = await cleanupExpiredFlipbooks(
      [row(), row({ id: "active", created_at: "2026-09-01T00:00:00.000Z" })],
      {
        removeStorageObjects: async () => { calls.push("storage"); },
        deleteFlipbookRow: async () => { calls.push("row"); },
      },
      new Date("2026-10-15T08:30:45.123Z"),
    );

    expect(calls).toEqual(["storage", "row"]);
    expect(summary).toEqual({ inspected: 2, expired: 1, deleted: 1, failed: 0 });
  });

  it("retains the row for retry when Storage deletion fails", async () => {
    const deleteFlipbookRow = vi.fn(async () => undefined);
    const summary = await cleanupExpiredFlipbooks(
      [row()],
      {
        removeStorageObjects: async () => { throw new Error("temporary Storage failure"); },
        deleteFlipbookRow,
      },
      new Date("2026-10-15T08:30:45.123Z"),
    );

    expect(deleteFlipbookRow).not.toHaveBeenCalled();
    expect(summary).toEqual({ inspected: 1, expired: 1, deleted: 0, failed: 1 });
  });

  it("reports a database failure after Storage succeeds so the next run can retry", async () => {
    const removeStorageObjects = vi.fn(async () => undefined);
    const summary = await cleanupExpiredFlipbooks(
      [row()],
      {
        removeStorageObjects,
        deleteFlipbookRow: async () => { throw new Error("temporary database failure"); },
      },
      new Date("2026-10-15T08:30:45.123Z"),
    );

    expect(removeStorageObjects).toHaveBeenCalledOnce();
    expect(summary).toEqual({ inspected: 1, expired: 1, deleted: 0, failed: 1 });
  });

  it("continues cleaning later rows when one expired record is malformed", async () => {
    const removedPaths: string[][] = [];
    const deletedIds: string[] = [];
    const summary = await cleanupExpiredFlipbooks(
      [
        row({ id: "malformed", storage_path: "uploads/../../wrong.pdf" }),
        row({ id: "valid" }),
      ],
      {
        removeStorageObjects: async (paths) => { removedPaths.push(paths); },
        deleteFlipbookRow: async (id) => { deletedIds.push(id); },
      },
      new Date("2026-10-15T08:30:45.123Z"),
    );

    expect(removedPaths).toEqual([["uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf"]]);
    expect(deletedIds).toEqual(["valid"]);
    expect(summary).toEqual({ inspected: 2, expired: 2, deleted: 1, failed: 1 });
  });
});
