"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { components } from "../../docs/api-types";

export type Schema = components["schemas"];

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch("/backend" + path, {
    method, cache: "no-store",
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/") && path !== "/me")
      window.location.assign(window.location.origin + "/login");
    throw new ApiError(response.status, payload.error?.code ?? "API_ERROR",
      payload.error?.message ?? "La requête a échoué.");
  }
  return payload as T;
}

let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function refresh() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function useResource<T>(key: string, load: (key: string) => Promise<T>) {
  const version = useSyncExternalStore(subscribe, () => revision, () => 0);
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>();
  useEffect(() => {
    if (!key) return;
    let active = true;
    void load(key).then(
      (value) => { if (active) setState({ key, value }); },
      (error: unknown) => { if (active) setState({ key, error: errorMessage(error) }); },
    );
    return () => { active = false; };
  }, [key, load, version]);
  const current = state?.key === key ? state : undefined;
  return { value: current?.value, error: current?.error, loading: !!key && !current };
}

export function useGet<T>(path: string) {
  const get = useCallback((key: string) => api<T>(key), []);
  return useResource(path, get);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}
