import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat-panel";
import { PageHeader } from "@/components/ui/primitives";
import { integrationModes } from "@/lib/env";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "AI Command Center" };

export default async function CommandPage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string; new?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx } = session;
  const { q, c, new: fresh } = await searchParams;
  const conversations = await ctx.db.list("conversations", undefined, { orderBy: "updated_at", ascending: false, limit: 20 });
  const conversationId = fresh ? null : (c ?? conversations[0]?.id ?? null);
  const messages = conversationId
    ? await ctx.db.list("conversation_messages", { conversation_id: conversationId }, { orderBy: "created_at" })
    : [];
  const ids = new Set(messages.flatMap((m) => m.approval_ids));
  const approvals = (await ctx.db.list("approvals")).filter((a) => ids.has(a.id));
  return (
    <>
      <PageHeader title="AI Command Center" description="Ask in plain language. Your agent looks up real records, explains what it will do, and waits for your approval before acting." />
      <ChatPanel
        key={conversationId ?? "new"}
        initialMessages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, tool_calls: m.tool_calls, approval_ids: m.approval_ids }))}
        initialApprovals={approvals}
        conversationId={conversationId}
        conversations={conversations.map((x) => ({ id: x.id, title: x.title }))}
        engine={integrationModes().ai}
        initialPrompt={q}
      />
    </>
  );
}
