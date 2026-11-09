"use client";

import {
  Activity,
  Bell,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface ShellProps {
  user: { name: string; email: string | null; isDemo: boolean };
  modes: { paypal: string; data: string; ai: string };
  approvals: Array<{ id: string; summary: string; kind: string }>;
  manualReviews: number;
  children: React.ReactNode;
}

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/command", label: "AI Command Center", icon: Sparkles },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/autopilot", label: "Autopilot", icon: Bot },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/activity", label: "Agent Activity", icon: Activity },
  { href: "/insights", label: "Insights", icon: LineChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="grid size-8 place-items-center rounded-[10px] bg-emerald-500 text-[13px] font-bold text-slate-950">CQ</div>
      {!collapsed && (
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide text-white">COLLECTIQ</div>
          <div className="text-[10px] text-sidebar-muted">Get paid, on autopilot</div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ user, modes, approvals, manualReviews, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem("ciq-sidebar") === "collapsed");
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("ciq-sidebar", c ? "expanded" : "collapsed");
      } catch {}
      return !c;
    });
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const notifCount = approvals.length + (manualReviews > 0 ? 1 : 0);
  const anyDemo = modes.paypal === "demo" || modes.data === "demo" || modes.ai === "demo";

  const nav = (isCollapsed: boolean) => (
    <nav className="flex flex-1 flex-col gap-0.5" aria-label="Primary">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          title={isCollapsed ? label : undefined}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-active hover:text-white",
            isActive(href) && "bg-sidebar-active text-white",
            isCollapsed && "justify-center px-0",
          )}
        >
          <Icon className={cn("size-[18px] shrink-0", isActive(href) ? "text-emerald-400" : "text-sidebar-muted")} />
          {!isCollapsed && <span className="truncate">{label}</span>}
          {!isCollapsed && href === "/autopilot" && approvals.length > 0 ? (
            <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-400">{approvals.length}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col gap-6 bg-sidebar p-3 md:flex transition-[width]", collapsed ? "w-[68px]" : "w-60")}>
        <div className="flex items-center justify-between pt-1">
          <Logo collapsed={collapsed} />
        </div>
        {nav(collapsed)}
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-xs text-sidebar-muted hover:bg-sidebar-active hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="mx-auto size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col gap-6 bg-sidebar p-3">
            <div className="flex items-center justify-between pt-1">
              <Logo collapsed={false} />
              <button onClick={() => setMobileOpen(false)} className="rounded-md p-1 text-sidebar-muted" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {anyDemo && (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-xs text-warning">
            <FlaskConical className="size-3.5 shrink-0" />
            <span className="truncate">
              <strong>Demo mode</strong>
              {modes.paypal === "demo" ? " · PayPal not connected: sends and reminders are simulated, nothing reaches PayPal" : ""}
              {modes.ai === "demo" ? " · Rule-based AI (Claude not configured)" : ""}
              {modes.data === "demo" ? " · Local demo database" : ""}
            </span>
            <Link href="/settings#integrations" className="ml-auto shrink-0 font-medium underline-offset-2 hover:underline">
              Set up
            </Link>
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 hover:bg-muted md:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <form
            className="relative flex max-w-xl flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!query.trim()) return;
              router.push(`/command?q=${encodeURIComponent(query.trim())}`);
              setQuery("");
            }}
          >
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask your agent… e.g. “Show invoices due this week”"
              aria-label="Ask the AI agent"
              className="h-9 w-full rounded-[10px] border border-border bg-card pl-9 pr-14 text-sm placeholder:text-muted-foreground/70"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:block">Ctrl K</kbd>
          </form>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="rounded-[10px] p-2 hover:bg-muted"
              aria-label="Toggle theme"
            >
              {mounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="relative rounded-[10px] p-2 hover:bg-muted" aria-label={`Notifications (${notifCount})`}>
                <Bell className="size-4" />
                {notifCount > 0 && <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-amber-500 text-[9px] font-bold text-slate-950">{notifCount}</span>}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-80 rounded-[12px] border border-border bg-card p-2 shadow-lg">
                  <div className="px-2 py-1.5 text-xs font-semibold">Notifications</div>
                  {notifCount === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">You&apos;re all caught up.</p>
                  ) : (
                    <>
                      {approvals.slice(0, 6).map((a) => (
                        <DropdownMenu.Item key={a.id} asChild>
                          <Link href="/autopilot#approvals" className="block rounded-[8px] px-2 py-2 text-xs outline-none hover:bg-muted data-[highlighted]:bg-muted">
                            <span className="font-medium text-warning">Needs approval · </span>
                            {a.summary}
                          </Link>
                        </DropdownMenu.Item>
                      ))}
                      {manualReviews > 0 && (
                        <DropdownMenu.Item asChild>
                          <Link href="/activity?filter=approval" className="block rounded-[8px] px-2 py-2 text-xs outline-none hover:bg-muted data-[highlighted]:bg-muted">
                            <span className="font-medium text-danger">Manual review · </span>
                            {manualReviews} invoice{manualReviews === 1 ? "" : "s"} need your personal follow-up
                          </Link>
                        </DropdownMenu.Item>
                      )}
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="ml-1 flex items-center gap-2 rounded-[10px] px-1.5 py-1 hover:bg-muted" aria-label="Profile menu">
                <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-[12px] border border-border bg-card p-2 shadow-lg">
                  <div className="px-2 py-1.5">
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                    {user.isDemo && <Badge tone="warning" className="mt-1.5">Demo account</Badge>}
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item asChild>
                    <Link href="/settings" className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted">
                      <Settings className="size-4" /> Settings
                    </Link>
                  </DropdownMenu.Item>
                  {!user.isDemo && (
                    <DropdownMenu.Item
                      onSelect={async () => {
                        await fetch("/api/auth/logout", { method: "POST" });
                        router.push("/login");
                        router.refresh();
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted"
                    >
                      <LogOut className="size-4" /> Sign out
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
