import type { UserDb } from "@/lib/db/user-db";
import type { GatewayResolver } from "@/lib/paypal";
import type { AgentActivity } from "@/lib/types";

export interface ServiceContext {
  db: UserDb;
  gateways: GatewayResolver;
  now: () => Date;
}

/** An expected, user-facing failure (validation, permission, PayPal error…). */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "bad_request",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

type ActivityInput = Partial<Omit<AgentActivity, "id" | "user_id" | "created_at" | "updated_at">> &
  Pick<AgentActivity, "category" | "execution_status" | "trigger">;

export function recordActivity(ctx: ServiceContext, a: ActivityInput) {
  return ctx.db.insert("agent_activity", {
    invoice_id: null,
    client_id: null,
    observed_condition: null,
    reasoning: null,
    proposed_action: null,
    permission_result: null,
    approval_status: null,
    paypal_ref: null,
    error: null,
    mode: "internal",
    metadata: {},
    ...a,
  });
}
