import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { sendInvoice } from "@/lib/services/invoices";

export const POST = apiRoute<{ id: string }>(async (_req, { ctx }, { id }) => {
  const invoice = await sendInvoice(ctx, id, { actor: "user" });
  return NextResponse.json({ invoice });
});
