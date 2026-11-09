import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/server";
import { cancelInvoice } from "@/lib/services/invoices";

const schema = z.object({ reason: z.string().trim().max(500).optional() });

export const POST = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const body = schema.parse(await req.json().catch(() => ({})));
  const invoice = await cancelInvoice(ctx, id, { actor: "user", reason: body.reason });
  return NextResponse.json({ invoice });
});
