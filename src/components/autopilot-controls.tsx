"use client";

import { Lightbulb, Pause, Play, Rocket } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/components/use-api";

interface CycleResult {
  evaluated: number;
  executed: number;
  approvalsRequested: number;
  manualReviews: number;
  blocked: number;
  suppressed: number;
  failed: number;
  skipped: number;
  details: Array<{ invoice: string; outcome: string; reason: string }>;
}

export function RunAutopilotButton() {
  const { run, pending } = useApi();
  const [result, setResult] = useState<CycleResult | null>(null);
  return (
    <div className="relative flex flex-col items-end gap-2">
      <Button
        onClick={async () => {
          const r = await run<{ result: CycleResult }>("run", "/api/autopilot/run", {});
          if (r) setResult(r.result);
        }}
        disabled={pending !== null}
      >
        <Rocket /> {pending ? "Running…" : "Run collection cycle now"}
      </Button>
      {result && (
        <div className="absolute right-0 top-full z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-[12px] border border-border bg-card p-3 text-xs shadow-lg" role="status">
          <button onClick={() => setResult(null)} className="float-right ml-2 text-muted-foreground hover:text-foreground" aria-label="Dismiss result">
            ✕
          </button>
          <p className="font-medium">
            Checked {result.evaluated} open invoice{result.evaluated === 1 ? "" : "s"}: {result.executed} reminder{result.executed === 1 ? "" : "s"} sent, {result.approvalsRequested} awaiting approval, {result.manualReviews} manual review, {result.blocked} blocked, {result.suppressed} suppressed, {result.failed} failed.
          </p>
          {result.details.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-muted-foreground">
              {result.details.map((d, i) => (
                <li key={i}>
                  <span className="font-mono">{d.invoice}</span> · {d.outcome.replace(/_/g, " ")}: {d.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function PolicyStatusToggle({ id, status }: { id: string; status: "active" | "paused" }) {
  const { run, pending } = useApi();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending !== null}
      onClick={() => run("t", `/api/policies/${id}`, { status: status === "active" ? "paused" : "active" }, { method: "PATCH", success: status === "active" ? "Policy paused" : "Policy activated" })}
    >
      {status === "active" ? <Pause /> : <Play />} {status === "active" ? "Pause" : "Activate"}
    </Button>
  );
}

export function RecommendButton() {
  const { run, pending } = useApi();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending !== null}
        onClick={async () => {
          const r = await run<{ message: string }>("rec", "/api/autopilot/recommendations", {});
          if (r) setMsg(r.message);
        }}
      >
        <Lightbulb /> Analyse history and recommend
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
