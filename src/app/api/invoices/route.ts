import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { createInvoiceDraft } from "@/lib/services/invoices";

export const GET = apiRoute(async (_req, { ctx }) => {
  const invoices = await ctx.db.list("invoices", undefined, { orderBy: "created_at", ascending: false });
  return NextResponse.json({ invoices });
});

export const POST = apiRoute(async (req, { ctx }) => {
  const body = await req.json();
  const invoice = await createInvoiceDraft(ctx, body, { actor: "user" });
  return NextResponse.json({ invoice }, { status: 201 });
});
