import { NextResponse } from "next/server";
import { z } from "zod";
import { integrationModes } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { jsonError } from "@/lib/server";
import { supabaseForRequest } from "@/lib/supabase/server";

const schema = z.object({ email: z.email(), password: z.string().min(8).max(200) });

export async function POST(req: Request) {
  if (integrationModes().data !== "supabase") return jsonError("Sign-in is disabled in demo mode.", 400, "demo_mode");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Enter a valid email and a password of at least 8 characters.", 422, "validation");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (!rateLimit(`login:${ip}`, 10, 60_000).ok) return jsonError("Too many attempts. Try again shortly.", 429, "rate_limited");
  const sb = await supabaseForRequest();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return jsonError("Email or password is incorrect.", 401, "invalid_credentials");
  return NextResponse.json({ ok: true });
}
