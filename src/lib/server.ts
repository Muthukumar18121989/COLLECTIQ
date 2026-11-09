import "server-only";
import path from "node:path";
import { NextResponse, connection } from "next/server";
import { ZodError } from "zod";
import { DEFAULT_POLICY } from "@/lib/agent/default-policy";
import { MemoryStore } from "@/lib/db/memory-store";
import { seedDemoData } from "@/lib/db/seed";
import { NotFoundError, type Store } from "@/lib/db/store";
import { SupabaseStore } from "@/lib/db/supabase-store";
import { UserDb } from "@/lib/db/user-db";
import { integrationModes } from "@/lib/env";
import { log } from "@/lib/logger";
import { defaultGatewayResolver } from "@/lib/paypal";
import { type ServiceContext, ServiceError } from "@/lib/services/context";
import { supabaseAdmin, supabaseForRequest } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

const g = globalThis as unknown as { __ciqDemoStore?: MemoryStore };
export function demoStore(): MemoryStore {
  g.__ciqDemoStore ??= new MemoryStore(path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "demo-db.json"));
  return g.__ciqDemoStore;
}

/** Store with service-level access (scheduler, webhooks). */
export function systemStore(): Store {
  return integrationModes().data === "supabase" ? new SupabaseStore(supabaseAdmin()) : demoStore();
}

export interface SessionUser {
  id: string;
  email: string | null;
  isDemo: boolean;
}

async function ensureUserSetup(db: UserDb, user: SessionUser): Promise<Profile> {
  let profile = await db.store.get("profiles", user.id);
  if (!profile) {
    profile = await db.store.insert("profiles", {
      id: user.id,
      email: user.email,
      full_name: user.isDemo ? "Riley Morgan (demo)" : null,
      business_name: user.isDemo ? "Riley Morgan Design" : null,
      default_currency: "USD",
      autonomy_mode: "policy_driven",
      tax_rate_percent: 0,
      timezone: "UTC",
      agent_paused: false,
    });
  }
  if (!(await db.findOne("collection_policies", { is_default: true }))) {
    await db.insert("collection_policies", { ...DEFAULT_POLICY, is_demo: false });
  }
  if (user.isDemo && (await db.list("clients")).length === 0) {
    await seedDemoData(db);
  }
  return profile;
}

/** Resolve the current user and a scoped service context, or null if signed out. */
export async function getSession(): Promise<{ user: SessionUser; ctx: ServiceContext; profile: Profile } | null> {
  await connection(); // always per-request: never prerender user data
  const modes = integrationModes();
  let user: SessionUser;
  let store: Store;
  if (modes.data === "supabase") {
    const sb = await supabaseForRequest();
    const { data } = await sb.auth.getUser();
    if (!data.user) return null;
    user = { id: data.user.id, email: data.user.email ?? null, isDemo: false };
    store = new SupabaseStore(sb);
  } else {
    user = { id: DEMO_USER_ID, email: "demo@collectiq.local", isDemo: true };
    store = demoStore();
  }
  const db = new UserDb(store, user.id);
  const profile = await ensureUserSetup(db, user);
  return { user, profile, ctx: { db, gateways: defaultGatewayResolver(), now: () => new Date() } };
}

export function jsonError(message: string, status = 400, code = "error", details?: unknown) {
  return NextResponse.json({ error: message, code, details }, { status });
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Wrap an authenticated API route with consistent error handling. */
export function apiRoute<P = Record<string, string>>(
  handler: (req: Request, session: Session, params: P) => Promise<Response>,
) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    try {
      const session = await getSession();
      if (!session) return jsonError("Sign in required", 401, "unauthenticated");
      return await handler(req, session, (await routeCtx?.params) ?? ({} as P));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof ServiceError) return jsonError(e.message, e.status, e.code, e.details);
  if (e instanceof ZodError) return jsonError(e.issues[0]?.message ?? "Invalid input", 422, "validation", e.issues);
  if (e instanceof NotFoundError) return jsonError(e.message, 404, "not_found");
  if (e instanceof SyntaxError) return jsonError("Invalid JSON body", 400, "bad_json");
  log.error("api.unhandled", { error: (e as Error)?.message, stack: (e as Error)?.stack });
  return jsonError("Something went wrong on our side. Please try again.", 500, "internal");
}
