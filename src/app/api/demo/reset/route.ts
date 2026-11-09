import { NextResponse } from "next/server";
import { integrationModes } from "@/lib/env";
import { demoStore, jsonError } from "@/lib/server";

/** Demo mode only: wipe the local demo database; it is re-seeded on next page load. */
export async function POST() {
  if (integrationModes().data !== "demo") return jsonError("Reset is only available in demo mode.", 403, "not_demo");
  demoStore().reset();
  return NextResponse.json({ ok: true });
}
