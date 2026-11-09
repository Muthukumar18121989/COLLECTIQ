import "server-only";

// Central, server-only access to configuration. Nothing in this file may be
// imported by client components: it reads secrets.

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  paypal: {
    clientId: read("PAYPAL_CLIENT_ID"),
    clientSecret: read("PAYPAL_CLIENT_SECRET"),
    baseUrl: read("PAYPAL_BASE_URL") ?? "https://api-m.sandbox.paypal.com",
    webhookId: read("PAYPAL_WEBHOOK_ID"),
  },
  supabase: {
    url: read("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),
  },
  anthropic: {
    apiKey: read("ANTHROPIC_API_KEY"),
    model: read("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
  },
  cronSecret: read("CRON_SECRET"),
  appUrl: read("APP_URL") ?? "http://localhost:3000",
};

export type IntegrationModes = {
  paypal: "sandbox" | "live" | "demo";
  data: "supabase" | "demo";
  ai: "claude" | "demo";
  webhooksConfigured: boolean;
  cronConfigured: boolean;
};

export function integrationModes(): IntegrationModes {
  const paypalReady = Boolean(env.paypal.clientId && env.paypal.clientSecret);
  return {
    paypal: paypalReady
      ? env.paypal.baseUrl.includes("sandbox")
        ? "sandbox"
        : "live"
      : "demo",
    data:
      env.supabase.url && env.supabase.anonKey && env.supabase.serviceRoleKey
        ? "supabase"
        : "demo",
    ai: env.anthropic.apiKey ? "claude" : "demo",
    webhooksConfigured: Boolean(paypalReady && env.paypal.webhookId),
    cronConfigured: Boolean(env.cronSecret),
  };
}
