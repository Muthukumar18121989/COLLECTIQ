import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/login-form";
import { integrationModes } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  await connection();
  if (integrationModes().data === "demo") redirect("/");
  return (
    <div className="grid min-h-dvh place-items-center bg-sidebar px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-[12px] bg-emerald-500 font-bold text-slate-950">CQ</div>
          <h1 className="mt-4 text-xl font-semibold text-white">COLLECTIQ</h1>
          <p className="mt-1 text-sm text-sidebar-muted">Do the work. Let your agent get you paid.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
