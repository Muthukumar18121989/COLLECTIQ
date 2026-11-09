import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { ServiceError } from "@/lib/services/context";
import type { Currency } from "@/lib/types";
import { clientInputSchema } from "@/lib/validation";

export const GET = apiRoute(async (_req, { ctx }) => {
  return NextResponse.json({ clients: await ctx.db.list("clients", undefined, { orderBy: "name" }) });
});

export const POST = apiRoute(async (req, { ctx }) => {
  const input = clientInputSchema.parse(await req.json());
  const dupe = (await ctx.db.list("clients")).find((c) => c.email.toLowerCase() === input.email.toLowerCase());
  if (dupe) throw new ServiceError(`${dupe.name} already uses that email.`, 409, "duplicate_client");
  const client = await ctx.db.insert("clients", {
    name: input.name,
    email: input.email,
    company: input.company || null,
    phone: input.phone || null,
    currency: input.currency as Currency,
    notes: input.notes || null,
    collection_paused: false,
    dispute_open: false,
    dispute_note: null,
    is_demo: false,
  });
  return NextResponse.json({ client }, { status: 201 });
});
