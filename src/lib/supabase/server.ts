import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Supabase client bound to the signed-in user's session (RLS applies). */
export async function supabaseForRequest(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(env.supabase.url!, env.supabase.anonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;
/** Service-role client. Only for the scheduler and webhook handler; never sent to the browser. */
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(env.supabase.url!, env.supabase.serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
