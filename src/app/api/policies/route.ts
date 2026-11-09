import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { recordActivity } from "@/lib/services/context";
import { policyInputSchema } from "@/lib/validation";

export const POST = apiRoute(async (req, { ctx }) => {
  const input = policyInputSchema.parse(await req.json());
  if (input.is_default) {
    for (const p of await ctx.db.list("collection_policies", { is_default: true })) {
      await ctx.db.update("collection_policies", p.id, { is_default: false });
    }
  }
  const policy = await ctx.db.insert("collection_policies", {
    ...input,
    is_default: Boolean(input.is_default),
    reminder_note_template: input.reminder_note_template ?? null,
    is_demo: false,
  });
  await recordActivity(ctx, {
    category: policy.status === "active" ? "policy_activated" : "policy_paused",
    trigger: "You created a policy",
    proposed_action: `Policy "${policy.name}" created (${policy.status})`,
    execution_status: "succeeded",
  });
  return NextResponse.json({ policy }, { status: 201 });
});
