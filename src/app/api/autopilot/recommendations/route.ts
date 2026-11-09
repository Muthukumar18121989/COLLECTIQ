import { NextResponse } from "next/server";
import { createRecommendations } from "@/lib/agent/adaptive";
import { apiRoute } from "@/lib/server";

export const POST = apiRoute(async (_req, { ctx }) => {
  return NextResponse.json(await createRecommendations(ctx));
});
