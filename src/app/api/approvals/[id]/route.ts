import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/server";
import { decideApproval } from "@/lib/services/approvals";
import { decisionSchema } from "@/lib/validation";

export const POST = apiRoute<{ id: string }>(async (req, { ctx }, { id }) => {
  const { decision } = decisionSchema.parse(await req.json());
  const approval = await decideApproval(ctx, id, decision);
  return NextResponse.json({ approval });
});
