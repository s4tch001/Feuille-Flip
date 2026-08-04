import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

async function keepSupabaseAwake() {
  const url = Netlify.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey =
    Netlify.env.get("SUPABASE_SECRET_KEY") ?? Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secretKey) throw new Error("Supabase environment variables are missing.");

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.from("flipbooks").select("id", { head: true, count: "exact" });
  if (error) throw new Error(`Supabase health query failed: ${error.code}`);

  console.log("Supabase keep-awake health query succeeded.");
}

export default keepSupabaseAwake;

export const config: Config = {
  schedule: "0 1,9,17 * * *",
};
