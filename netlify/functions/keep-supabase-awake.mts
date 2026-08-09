import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

import {
  cleanupExpiredFlipbooks,
  type RetentionCleanupSummary,
  type RetentionFlipbookRow,
} from "../../lib/flipbook-retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_SCAN_MINIMUM_AGE_DAYS = 89;
const RETENTION_SCAN_LIMIT = 1000;
const RETENTION_CLEANUP_CONCURRENCY = 5;
const RETENTION_RUN_BUDGET_MS = 20_000;

function addSummary(total: RetentionCleanupSummary, next: RetentionCleanupSummary) {
  total.inspected += next.inspected;
  total.expired += next.expired;
  total.deleted += next.deleted;
  total.failed += next.failed;
}

async function keepSupabaseAwake() {
  const runStartedAt = Date.now();
  const url = Netlify.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey =
    Netlify.env.get("SUPABASE_SECRET_KEY") ?? Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secretKey) throw new Error("Supabase environment variables are missing.");

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const retentionNow = new Date();
  const scanCutoff = new Date(retentionNow.getTime() - RETENTION_SCAN_MINIMUM_AGE_DAYS * DAY_MS);
  const { data, error } = await supabase
    .from("flipbooks")
    .select("id,created_at,storage_path,page_paths")
    .lte("created_at", scanCutoff.toISOString())
    .order("created_at", { ascending: true })
    .limit(RETENTION_SCAN_LIMIT);
  if (error) throw new Error(`Supabase retention scan failed: ${error.code}`);

  const rows = (data ?? []) as RetentionFlipbookRow[];
  const adapter = {
    removeStorageObjects: async (paths: string[]) => {
      const { error: storageError } = await supabase.storage.from("flipbooks").remove(paths);
      if (storageError) throw new Error(`Storage cleanup failed: ${storageError.name}`);
    },
    deleteFlipbookRow: async (id: string) => {
      const { error: deleteError } = await supabase.from("flipbooks").delete().eq("id", id);
      if (deleteError) throw new Error(`Database cleanup failed: ${deleteError.code}`);
    },
  };
  const summary: RetentionCleanupSummary = { inspected: 0, expired: 0, deleted: 0, failed: 0 };
  let processedRows = 0;

  while (
    processedRows < rows.length &&
    Date.now() - runStartedAt < RETENTION_RUN_BUDGET_MS
  ) {
    const batch = rows.slice(processedRows, processedRows + RETENTION_CLEANUP_CONCURRENCY);
    const results = await Promise.all(
      batch.map((row) => cleanupExpiredFlipbooks([row], adapter, retentionNow)),
    );
    results.forEach((result) => addSummary(summary, result));
    processedRows += batch.length;
  }

  const deferred = rows.length - processedRows;

  console.log("Supabase retention and keep-awake run completed.", { ...summary, deferred });
  if (summary.failed > 0 || deferred > 0) {
    throw new Error(`${summary.failed} failed and ${deferred} deferred cleanup operation(s) will be retried.`);
  }
}

export default keepSupabaseAwake;

export const config: Config = {
  schedule: "0 1 * * *",
};
