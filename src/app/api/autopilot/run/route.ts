import { NextResponse } from "next/server";
import { runCollectionCycle } from "@/lib/agent/scheduler";
import { rateLimit } from "@/lib/rate-limit";
import { apiRoute, jsonError } from "@/lib/server";

/** Run the collection cycle now for the signed-in user (same engine the cron job uses). */
export const POST = apiRoute(async (_req, { ctx, user }) => {
  const rl = rateLimit(`autopilot:${user.id}`, 6, 60_000);
  if (!rl.ok) return jsonError(`Please wait ${rl.retryAfterSec}s before running again.`, 429, "rate_limited");
  const result = await runCollectionCycle(ctx);
  return NextResponse.json({ result });
});
