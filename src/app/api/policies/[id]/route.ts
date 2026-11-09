import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { recordActivity } from "@/lib/services/context";
import { policyInputSchema } from "@/lib/validation";

export const PATCH = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const current = await ctx.db.require("collection_policies", id);
  const input = policyInputSchema.parse({ ...current, ...(await req.json()) });
  if (input.is_default && !current.is_default) {
    for (const p of await ctx.db.list("collection_policies", { is_default: true })) {
      await ctx.db.update("collection_policies", p.id, { is_default: false });
    }
  }
  const policy = await ctx.db.update("collection_policies", id, { ...input, is_default: input.is_default ?? current.is_default });
  const statusChanged = policy.status !== current.status;
  await recordActivity(ctx, {
    category: statusChanged ? (policy.status === "active" ? "policy_activated" : "policy_paused") : "policy_updated",
    trigger: "You edited the policy",
    proposed_action: statusChanged ? `Policy "${policy.name}" ${policy.status === "active" ? "activated" : "paused"}` : `Policy "${policy.name}" updated`,
    execution_status: "succeeded",
  });
  return NextResponse.json({ policy });
});
