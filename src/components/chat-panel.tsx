"use client";

import { ArrowUp, Bot, ChevronDown, Plus, Sparkles, User, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { apiFetch } from "@/components/use-api";
import type { Approval, ConversationMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Create an invoice for Sarah for $850 for branding work, due in seven days",
  "Show all overdue invoices",
  "Which client owes me the most money?",
  "Prepare reminders for clients who haven't paid",
  "How much money am I expecting this month?",
  "Pause reminders for Alex",
  "Show invoices due this week",
  "Explain why my outstanding balance has increased",
];

type Msg = Pick<ConversationMessage, "id" | "role" | "content" | "tool_calls" | "approval_ids">;

/** Minimal, safe markdown: **bold**, _italic_, bullet lists, paragraphs. No HTML injection. */
function RichText({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("_") && part.endsWith("_") && part.length > 2 ? (
        <em key={i}>{part.slice(1, -1)}</em>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="prose-chat text-sm leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const bullets = lines.filter((l) => /^\s*[-*]\s/.test(l));
        if (bullets.length && bullets.length === lines.filter((l) => l.trim()).length - (lines[0] && !/^\s*[-*]\s/.test(lines[0]) ? 1 : 0)) {
          const head = lines[0] && !/^\s*[-*]\s/.test(lines[0]) ? lines[0] : null;
          return (
            <div key={i}>
              {head && <p>{inline(head)}</p>}
              <ul>
                {bullets.map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*[-*]\s/, ""))}</li>
                ))}
              </ul>
            </div>
          );
        }
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

export function ChatPanel({
  initialMessages,
  initialApprovals,
  conversationId: initialConversation,
  conversations,
  engine,
  initialPrompt,
}: {
  initialMessages: Msg[];
  initialApprovals: Approval[];
  conversationId: string | null;
  conversations: Array<{ id: string; title: string }>;
  engine: "claude" | "demo";
  initialPrompt?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [approvals, setApprovals] = useState<Record<string, Approval>>(Object.fromEntries(initialApprovals.map((a) => [a.id, a])));
  const [conversationId, setConversationId] = useState(initialConversation);
  const [input, setInput] = useState(initialPrompt && !initialPrompt.endsWith(" ") ? "" : (initialPrompt ?? ""));
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput("");
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [...m, { id: tempId, role: "user", content: message, tool_calls: [], approval_ids: [] }]);
    try {
      const res = await apiFetch<{ conversation_id: string; reply: { text: string; toolCalls: Msg["tool_calls"]; approvals: Approval[] } }>("/api/ai/chat", {
        conversation_id: conversationId,
        message,
      });
      setConversationId(res.conversation_id);
      setApprovals((a) => ({ ...a, ...Object.fromEntries(res.reply.approvals.map((x) => [x.id, x])) }));
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: res.reply.text, tool_calls: res.reply.toolCalls, approval_ids: res.reply.approvals.map((x) => x.id) },
      ]);
      if (res.reply.approvals.length) router.refresh();
    } catch (e) {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "Something went wrong."} Nothing was changed.`, tool_calls: [], approval_ids: [] }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!sentInitial.current && initialPrompt && !initialPrompt.endsWith(" ")) {
      sentInitial.current = true;
      void send(initialPrompt);
      router.replace("/command");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[480px] flex-col overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-medium">Agent</span>
        {engine === "claude" ? <Badge tone="primary">Claude</Badge> : <Badge tone="warning">Demo AI · rule-based</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {conversations.length > 0 && (
            <div className="relative">
              <select
                aria-label="Conversation history"
                className="h-8 appearance-none rounded-[8px] border border-border bg-card pl-2 pr-7 text-xs"
                value={conversationId ?? ""}
                onChange={(e) => {
                  router.push(e.target.value ? `/command?c=${e.target.value}` : "/command?new=1");
                }}
              >
                <option value="">New conversation</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2" />
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => router.push("/command?new=1")} aria-label="New conversation">
            <Plus /> New
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
        {messages.length === 0 && !busy ? (
          <div className="mx-auto max-w-2xl">
            <p className="text-center text-sm font-medium">What should your agent do?</p>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              It works only with your saved clients and invoices. Anything that sends, creates or changes something waits for your approval.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => send(e)} className="rounded-[12px] border border-border bg-background px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((m) => (
              <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-muted" : "bg-primary-soft text-primary")}>
                  {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                </span>
                <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-2", m.role === "user" && "items-end")}>
                  <div className={cn("rounded-[12px] px-3.5 py-2.5", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60")}>
                    {m.role === "user" ? <p className="text-sm">{m.content}</p> : <RichText text={m.content} />}
                  </div>
                  {m.tool_calls.length > 0 && (
                    <details className="text-[11px] text-muted-foreground">
                      <summary className="flex cursor-pointer items-center gap-1">
                        <Wrench className="size-3" /> {m.tool_calls.length} tool call{m.tool_calls.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-4">
                        {m.tool_calls.map((t, i) => (
                          <li key={i}>
                            <code className="font-mono">{t.name}</code> → {t.result_summary}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {m.approval_ids.map((id) =>
                    approvals[id] ? (
                      <div key={id} className="w-full">
                        <ApprovalCard approval={approvals[id]} onChange={(a) => setApprovals((x) => ({ ...x, [a.id]: a }))} />
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-3">
                <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-primary">
                  <Bot className="size-3.5" />
                </span>
                <div className="rounded-[12px] bg-muted/60 px-3.5 py-2.5 text-sm text-muted-foreground">
                  <span className="inline-flex gap-1">
                    <span className="animate-pulse">Checking your records</span>…
                  </span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Tell your agent what to do…"
            aria-label="Message the agent"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-[12px] border border-input bg-background px-3 py-2.5 text-sm"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
            <ArrowUp />
          </Button>
        </div>
      </form>
    </div>
  );
}
