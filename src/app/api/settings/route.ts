import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { recordActivity } from "@/lib/services/context";
import type { Profile } from "@/lib/types";
import { settingsSchema } from "@/lib/validation";

export const PATCH = apiRoute(async (req, { ctx, profile }) => {
  const patch = settingsSchema.parse(await req.json());
  const updated = await ctx.db.updateProfile(patch as Partial<Profile>);
  const changes: string[] = [];
  if (patch.autonomy_mode && patch.autonomy_mode !== profile.autonomy_mode) changes.push(`autonomy mode → ${patch.autonomy_mode}`);
  if (patch.agent_paused !== undefined && patch.agent_paused !== profile.agent_paused) changes.push(patch.agent_paused ? "agent paused" : "agent resumed");
  if (changes.length) {
    await recordActivity(ctx, {
      category: "settings_changed",
      trigger: "You changed Settings",
      proposed_action: changes.join(", "),
      execution_status: "succeeded",
    });
  }
  return NextResponse.json({ profile: updated });
});
