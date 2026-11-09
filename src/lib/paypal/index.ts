import "server-only";
import { env, integrationModes } from "@/lib/env";
import type { Invoice } from "@/lib/types";
import { PayPalClient } from "./client";
import { DemoPayPalGateway, LivePayPalGateway, type PayPalGateway } from "./gateway";

let client: PayPalClient | null = null;

export function paypalClient(): PayPalClient | null {
  const { clientId, clientSecret, baseUrl } = env.paypal;
  if (!clientId || !clientSecret) return null;
  client ??= new PayPalClient({ clientId, clientSecret, baseUrl });
  return client;
}

export interface GatewayResolver {
  /** Gateway for an invoice. Demo invoices always stay on the demo gateway. */
  forInvoice(inv: Pick<Invoice, "paypal_mode">): PayPalGateway;
}

export function defaultGatewayResolver(): GatewayResolver {
  const demo = new DemoPayPalGateway();
  return {
    forInvoice(inv) {
      if (inv.paypal_mode === "demo") return demo;
      const c = paypalClient();
      const mode = integrationModes().paypal;
      if (c && mode !== "demo") return new LivePayPalGateway(c, mode);
      if (inv.paypal_mode === "sandbox" || inv.paypal_mode === "live") {
        throw new Error(
          "This invoice lives in PayPal, but PayPal credentials are not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
        );
      }
      return demo;
    },
  };
}
