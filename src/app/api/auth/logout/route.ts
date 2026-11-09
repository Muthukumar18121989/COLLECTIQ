import { NextResponse } from "next/server";
import { integrationModes } from "@/lib/env";
import { supabaseForRequest } from "@/lib/supabase/server";

export async function POST() {
  if (integrationModes().data === "supabase") {
    const sb = await supabaseForRequest();
    await sb.auth.signOut();
  }
  return NextResponse.json({ ok: true });
}
