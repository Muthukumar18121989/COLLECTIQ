import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { syncInvoice } from "@/lib/services/invoices";

export const POST = apiRoute<{ id: string }>(async (_req, { ctx }, { id }) => {
  const invoice = await syncInvoice(ctx, id);
  return NextResponse.json({ invoice });
});
