import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { updateDraft } from "@/lib/services/invoices";

export const GET = apiRoute<{ id: string }>(async (_req, { ctx }, { id }) => {
  const invoice = await ctx.db.require("invoices", id);
  const items = await ctx.db.list("invoice_items", { invoice_id: id });
  return NextResponse.json({ invoice, items });
});

export const PATCH = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const invoice = await updateDraft(ctx, id, await req.json());
  return NextResponse.json({ invoice });
});
