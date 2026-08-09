export const FLIPBOOK_RETENTION_MONTHS = 3;

export type RetentionFlipbookRow = {
  id: string;
  created_at: string;
  storage_path: string | null;
  page_paths: unknown;
};

export type RetentionCleanupAdapter = {
  removeStorageObjects: (paths: string[]) => Promise<void>;
  deleteFlipbookRow: (id: string) => Promise<void>;
};

export type RetentionCleanupSummary = {
  inspected: number;
  expired: number;
  deleted: number;
  failed: number;
};

function toValidDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid publication date is required.");
  return date;
}

/**
 * Adds calendar months in UTC, clamping month-end dates like Jan 31 to Apr 30.
 * UTC keeps the retention boundary independent from server and deployment time zones.
 */
export function addCalendarMonthsUtc(value: Date | string, months: number): Date {
  if (!Number.isInteger(months)) throw new TypeError("Calendar months must be an integer.");

  const result = toValidDate(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

export function getFlipbookExpiry(publishedAt: Date | string): Date {
  return addCalendarMonthsUtc(publishedAt, FLIPBOOK_RETENTION_MONTHS);
}

export function isFlipbookExpired(
  publishedAt: Date | string,
  now: Date = new Date(),
): boolean {
  return toValidDate(now).getTime() >= getFlipbookExpiry(publishedAt).getTime();
}

const PDF_STORAGE_PATH = /^uploads\/[0-9a-f-]{36}\.pdf$/;
const PAGE_STORAGE_PATH = /^pages\/([0-9a-f-]{36})\/\d{4}\.webp$/;

/**
 * Converts trusted database metadata into a narrowly validated deletion list.
 * Rejecting malformed paths prevents a service-role cleanup from deleting outside
 * the flipbook's expected upload prefixes.
 */
export function getFlipbookStoragePaths(row: RetentionFlipbookRow): string[] {
  if (row.storage_path !== null) {
    if (row.page_paths !== null || !PDF_STORAGE_PATH.test(row.storage_path)) {
      throw new Error(`Flipbook ${row.id} has invalid PDF retention metadata.`);
    }
    return [row.storage_path];
  }

  if (!Array.isArray(row.page_paths) || row.page_paths.length === 0) {
    throw new Error(`Flipbook ${row.id} has no valid page retention metadata.`);
  }

  let expectedPrefix: string | undefined;
  const paths = row.page_paths.map((path) => {
    if (typeof path !== "string") {
      throw new Error(`Flipbook ${row.id} has a non-string page path.`);
    }
    const match = PAGE_STORAGE_PATH.exec(path);
    if (!match) throw new Error(`Flipbook ${row.id} has an invalid page path.`);
    expectedPrefix ??= match[1];
    if (match[1] !== expectedPrefix) {
      throw new Error(`Flipbook ${row.id} contains paths from multiple page prefixes.`);
    }
    return path;
  });

  return [...new Set(paths)];
}

/**
 * Deletes Storage first, then its database row. A failed Storage deletion leaves
 * the expired row in place for a later retry instead of orphaning public files.
 */
export async function cleanupExpiredFlipbooks(
  rows: RetentionFlipbookRow[],
  adapter: RetentionCleanupAdapter,
  now: Date = new Date(),
): Promise<RetentionCleanupSummary> {
  const summary: RetentionCleanupSummary = {
    inspected: rows.length,
    expired: 0,
    deleted: 0,
    failed: 0,
  };

  for (const row of rows) {
    let expired: boolean;
    try {
      expired = isFlipbookExpired(row.created_at, now);
    } catch {
      summary.failed += 1;
      continue;
    }
    if (!expired) continue;
    summary.expired += 1;

    try {
      const storagePaths = getFlipbookStoragePaths(row);
      await adapter.removeStorageObjects(storagePaths);
      await adapter.deleteFlipbookRow(row.id);
      summary.deleted += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
