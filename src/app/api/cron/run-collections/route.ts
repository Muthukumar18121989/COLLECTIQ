import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runCollectionCycle } from "@/lib/agent/scheduler";
import { UserDb } from "@/lib/db/user-db";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { defaultGatewayResolver } from "@/lib/paypal";
import { jsonError, systemStore } from "@/lib/server";

function authorized(req: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled collection run for every user. Trigger from a Render Cron Job:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/run-collections
 */
export async function POST(req: Request) {
  if (!env.cronSecret) return jsonError("CRON_SECRET is not configured", 503, "cron_not_configured");
  if (!authorized(req)) return jsonError("Unauthorized", 401, "unauthorized");

  const store = systemStore();
  const profiles = await store.list("profiles");
  const results: Array<{ user: string; result?: unknown; error?: string }> = [];
  for (const p of profiles) {
    try {
      const ctx = { db: new UserDb(store, p.id), gateways: defaultGatewayResolver(), now: () => new Date() };
      results.push({ user: p.id, result: await runCollectionCycle(ctx) });
    } catch (e) {
      log.error("cron.user_failed", { user: p.id, error: (e as Error).message });
      results.push({ user: p.id, error: (e as Error).message });
    }
  }
  log.info("cron.completed", { users: profiles.length });
  return NextResponse.json({ ran_at: new Date().toISOString(), users: profiles.length, results });
}
