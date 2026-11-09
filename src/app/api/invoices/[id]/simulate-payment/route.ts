import { NextResponse } from "next/server";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { apiRoute } from "@/lib/server";
import { simulateDemoPayment } from "@/lib/services/demo";

const schema = z.object({ amount: z.coerce.number().positive().optional() });

/** DEMO MODE ONLY: refuses any invoice that lives in PayPal. */
export const POST = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const { amount } = schema.parse(await req.json().catch(() => ({})));
  const invoice = await simulateDemoPayment(ctx, id, amount ? toCents(amount) : undefined);
  return NextResponse.json({ invoice, demo: true });
});
