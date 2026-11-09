"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { useApi } from "@/components/use-api";

export function AiSummary({ initial, engine }: { initial: string; engine: "claude" | "demo" }) {
  const [text, setText] = useState(initial);
  const [source, setSource] = useState<"computed" | "claude" | "demo">("computed");
  const { run, pending } = useApi();
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-semibold">Financial summary</span>
        <Badge tone={source === "claude" ? "primary" : "neutral"}>{source === "claude" ? "Written by Claude from your figures" : "Computed from your invoices"}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={pending !== null}
          onClick={async () => {
            const r = await run<{ text: string; engine: "claude" | "demo" }>("ai", "/api/ai/insights", {}, { refresh: false });
            if (r) {
              setText(r.text);
              setSource(r.engine === "claude" ? "claude" : "demo");
            }
          }}
        >
          <RefreshCw className={pending ? "animate-spin" : ""} /> {engine === "claude" ? "Generate AI briefing" : "Refresh"}
        </Button>
      </div>
      <div className="whitespace-pre-line text-sm leading-relaxed">{text}</div>
    </div>
  );
}
