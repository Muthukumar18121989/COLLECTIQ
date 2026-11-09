import { checkPermission, type Actor } from "@/lib/agent/permissions";
import { type ServiceContext, ServiceError, recordActivity } from "./context";

export async function setCollectionPaused(
  ctx: ServiceContext,
  opts: { clientId?: string | null; invoiceId?: string | null; paused: boolean; actor: Actor; approved?: boolean },
) {
  const profile = await ctx.db.profile();
  const perm = checkPermission({
    op: opts.paused ? "pause_collection" : "resume_collection",
    actor: opts.actor,
    autonomyMode: profile.autonomy_mode,
    agentPaused: profile.agent_paused,
    approved: Boolean(opts.approved),
  });
  if (perm.decision !== "allow") throw new ServiceError(perm.reason, 403, perm.code);

  if (opts.invoiceId) {
    const inv = await ctx.db.update("invoices", opts.invoiceId, { collection_paused: opts.paused });
    await recordActivity(ctx, {
      category: opts.paused ? "policy_paused" : "policy_activated",
      invoice_id: inv.id,
      client_id: inv.client_id,
      trigger: opts.actor === "user" ? "You changed it" : "Approved agent action",
      proposed_action: `${opts.paused ? "Paused" : "Resumed"} reminders for ${inv.invoice_number}`,
      execution_status: "succeeded",
    });
    return;
  }
  if (opts.clientId) {
    const c = await ctx.db.update("clients", opts.clientId, { collection_paused: opts.paused });
    await recordActivity(ctx, {
      category: opts.paused ? "policy_paused" : "policy_activated",
      client_id: c.id,
      trigger: opts.actor === "user" ? "You changed it" : "Approved agent action",
      proposed_action: `${opts.paused ? "Paused" : "Resumed"} reminders for ${c.name}`,
      execution_status: "succeeded",
    });
    return;
  }
  throw new ServiceError("Choose a client or invoice to pause.", 422, "validation");
}

export async function setDispute(ctx: ServiceContext, clientId: string, open: boolean, note: string | null) {
  const c = await ctx.db.update("clients", clientId, { dispute_open: open, dispute_note: open ? note : null });
  await recordActivity(ctx, {
    category: open ? "policy_paused" : "policy_activated",
    client_id: c.id,
    trigger: "You recorded it",
    observed_condition: open ? `Dispute / objection recorded: ${note ?? "no details"}` : "Dispute resolved",
    proposed_action: open ? `All collection for ${c.name} stopped` : `Collection for ${c.name} may resume`,
    execution_status: "succeeded",
  });
  return c;
}
