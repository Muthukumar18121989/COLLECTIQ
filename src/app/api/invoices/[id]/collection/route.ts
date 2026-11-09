import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/server";
import { setCollectionPaused } from "@/lib/services/collection";

const schema = z.object({ paused: z.boolean() });

export const POST = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const { paused } = schema.parse(await req.json());
  await setCollectionPaused(ctx, { invoiceId: id, paused, actor: "user" });
  return NextResponse.json({ ok: true });
});
