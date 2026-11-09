import { NextResponse } from "next/server";
import { runClaudeAgent } from "@/lib/agent/claude-agent";
import { runDemoAgent } from "@/lib/agent/demo-agent";
import { integrationModes } from "@/lib/env";
import { log } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { apiRoute, jsonError } from "@/lib/server";
import { chatInputSchema } from "@/lib/validation";

export const GET = apiRoute(async (req, { ctx }) => {
  const id = new URL(req.url).searchParams.get("conversation_id");
  const conversations = await ctx.db.list("conversations", undefined, { orderBy: "updated_at", ascending: false, limit: 20 });
  const conversationId = id ?? conversations[0]?.id ?? null;
  const messages = conversationId
    ? await ctx.db.list("conversation_messages", { conversation_id: conversationId }, { orderBy: "created_at" })
    : [];
  const approvalIds = new Set(messages.flatMap((m) => m.approval_ids));
  const approvals = (await ctx.db.list("approvals")).filter((a) => approvalIds.has(a.id));
  return NextResponse.json({ conversations, conversation_id: conversationId, messages, approvals });
});

export const POST = apiRoute(async (req, { ctx, user }) => {
  const rl = rateLimit(`ai:${user.id}`, 20, 60_000);
  if (!rl.ok) return jsonError(`Too many requests. Try again in ${rl.retryAfterSec}s.`, 429, "rate_limited");

  const { conversation_id, message } = chatInputSchema.parse(await req.json());
  const conversation = conversation_id
    ? await ctx.db.require("conversations", conversation_id)
    : await ctx.db.insert("conversations", { title: message.slice(0, 60) });
  const history = await ctx.db.list("conversation_messages", { conversation_id: conversation.id }, { orderBy: "created_at" });
  await ctx.db.insert("conversation_messages", { conversation_id: conversation.id, role: "user", content: message, tool_calls: [], approval_ids: [] });

  const engine = integrationModes().ai;
  let reply;
  try {
    reply = engine === "claude" ? await runClaudeAgent(ctx, history, message) : await runDemoAgent(ctx, message);
  } catch (e) {
    log.error("ai.chat_failed", { error: (e as Error).message });
    const text = "I couldn't reach the AI service just now, so nothing was changed. Please try again in a moment.";
    await ctx.db.insert("conversation_messages", { conversation_id: conversation.id, role: "assistant", content: text, tool_calls: [], approval_ids: [] });
    return NextResponse.json({ conversation_id: conversation.id, reply: { text, toolCalls: [], approvals: [], engine }, error: true });
  }
  const saved = await ctx.db.insert("conversation_messages", {
    conversation_id: conversation.id,
    role: "assistant",
    content: reply.text,
    tool_calls: reply.toolCalls,
    approval_ids: reply.approvals.map((a) => a.id),
  });
  await ctx.db.update("conversations", conversation.id, { title: conversation.title });
  return NextResponse.json({ conversation_id: conversation.id, message: saved, reply });
});
