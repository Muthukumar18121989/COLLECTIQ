import type { Metadata } from "next";
import { AutonomyForm, DemoDataControls, ProfileForm, TestPayPalButton } from "@/components/settings-forms";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { env, integrationModes } from "@/lib/env";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Settings" };

function Status({ ok, okText, noText }: { ok: boolean; okText: string; noText: string }) {
  return ok ? <Badge tone="success">{okText}</Badge> : <Badge tone="warning">{noText}</Badge>;
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) return null;
  const { profile } = session;
  const m = integrationModes();
  const base = env.appUrl.replace(/\/$/, "");

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Business profile</CardTitle>
              <CardDescription>Used on invoices and in agent messages</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ProfileForm profile={profile} />
          </CardContent>
        </Card>

        <Card id="autonomy">
          <CardHeader>
            <div>
              <CardTitle>Agent autonomy</CardTitle>
              <CardDescription>How much the agent may do on its own. The backend permission service enforces this on every operation.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <AutonomyForm mode={profile.autonomy_mode} paused={profile.agent_paused} />
          </CardContent>
        </Card>

        <Card id="integrations">
          <CardHeader>
            <div>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Status reflects the server&apos;s environment variables. Secrets are never shown or sent to the browser.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-[12px] border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">PayPal Invoicing</span>
                <Status ok={m.paypal !== "demo"} okText={`Configured · ${m.paypal === "sandbox" ? "Sandbox" : "Live"}`} noText="Not configured · demo mode" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {m.paypal === "demo"
                  ? "Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_BASE_URL (https://api-m.sandbox.paypal.com). Until then, sends and reminders are simulated and labelled Demo."
                  : `Base URL ${env.paypal.baseUrl}. New invoices are created and sent through PayPal.`}
              </p>
              <div className="mt-2">
                <TestPayPalButton configured={m.paypal !== "demo"} />
              </div>
            </div>
            <div className="rounded-[12px] border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">PayPal webhooks</span>
                <Status ok={m.webhooksConfigured} okText="Webhook ID set" noText="Not configured" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                In the PayPal developer dashboard, add a webhook pointing to <code className="rounded bg-muted px-1 font-mono">{base}/api/webhooks/paypal</code> subscribed to the INVOICING.INVOICE.* events, then set PAYPAL_WEBHOOK_ID. Every event is verified with PayPal before it is processed.
              </p>
            </div>
            <div className="rounded-[12px] border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Claude (Anthropic API)</span>
                <Status ok={m.ai === "claude"} okText={`Configured · ${env.anthropic.model}`} noText="Not configured · rule-based demo AI" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Set ANTHROPIC_API_KEY to enable Claude in the AI Command Center and Insights.</p>
            </div>
            <div className="rounded-[12px] border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Supabase (database &amp; auth)</span>
                <Status ok={m.data === "supabase"} okText="Configured" noText="Not configured · local demo database" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY and run the migration in supabase/migrations.</p>
            </div>
            <div className="rounded-[12px] border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Scheduled collection runs</span>
                <Status ok={m.cronConfigured} okText="CRON_SECRET set" noText="Not configured" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Schedule <code className="rounded bg-muted px-1 font-mono">POST {base}/api/cron/run-collections</code> with header <code className="rounded bg-muted px-1 font-mono">Authorization: Bearer $CRON_SECRET</code>, e.g. hourly from a Render Cron Job.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Demo data</CardTitle>
              <CardDescription>Fictional clients and invoices, all marked as demo, so you can try every workflow. Demo invoices never reach PayPal.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DemoDataControls dataMode={m.data} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
