"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: unknown) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code, data.details);
  return data as T;
}

/** Call an API route, toast errors, and refresh server components on success. */
export function useApi() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, url: string, body?: unknown, opts: { method?: string; success?: string; refresh?: boolean } = {}): Promise<T | null> => {
      setPending(key);
      try {
        const data = await apiFetch<T>(url, body, opts.method);
        if (opts.success) toast.success(opts.success);
        if (opts.refresh !== false) router.refresh();
        return data;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return null;
      } finally {
        setPending(null);
      }
    },
    [router],
  );
  return { run, pending };
}
