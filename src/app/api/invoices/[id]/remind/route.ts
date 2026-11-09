import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/server";
import { remindInvoice } from "@/lib/services/invoices";

const schema = z.object({
  tone: z.enum(["friendly", "neutral", "firm"]).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const POST = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const body = schema.parse(await req.json().catch(() => ({})));
  const out = await remindInvoice(ctx, id, { actor: "user", tone: body.tone, note: body.note || undefined, trigger: "You clicked Send reminder" });
  return NextResponse.json(out);
});
