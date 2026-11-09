import { NextResponse } from "next/server";
import { seedDemoData } from "@/lib/db/seed";
import { apiRoute } from "@/lib/server";

/** Load the labelled demo dataset into the current account (all rows is_demo = true). */
export const POST = apiRoute(async (_req, { ctx }) => {
  const r = await seedDemoData(ctx.db);
  return NextResponse.json({ ...r, message: r.created ? "Demo data loaded." : "Demo data is already loaded." });
});
