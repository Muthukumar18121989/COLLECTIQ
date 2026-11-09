import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { setCollectionPaused, setDispute } from "@/lib/services/collection";
import type { Client } from "@/lib/types";
import { clientPatchSchema } from "@/lib/validation";

export const PATCH = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const patch = clientPatchSchema.parse(await req.json());
  const current = await ctx.db.require("clients", id);
  if (patch.collection_paused !== undefined && patch.collection_paused !== current.collection_paused) {
    await setCollectionPaused(ctx, { clientId: id, paused: patch.collection_paused, actor: "user" });
  }
  if (patch.dispute_open !== undefined && patch.dispute_open !== current.dispute_open) {
    await setDispute(ctx, id, patch.dispute_open, patch.dispute_note ?? null);
  }
  const { collection_paused: _p, dispute_open: _d, dispute_note: _n, ...rest } = patch;
  void _p;
  void _d;
  void _n;
  const client = Object.keys(rest).length ? await ctx.db.update("clients", id, rest as Partial<Client>) : await ctx.db.require("clients", id);
  return NextResponse.json({ client });
});
