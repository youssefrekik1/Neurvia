"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { components } from "../../docs/api-types";

export type Schema = components["schemas"];

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const multipart = data instanceof FormData;
  const response = await fetch("/backend" + path, {
    method, cache: "no-store",
    headers: data === undefined || multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? data : data === undefined ? undefined : JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      cacheGeneration += 1;
      resourceCache = new WeakMap();
    }
    if (response.status === 401 && !path.startsWith("/auth/") && path !== "/me")
      window.location.assign(window.location.origin + "/login");
    throw new ApiError(response.status, payload.error?.code ?? "API_ERROR",
      payload.error?.message ?? "La requête a échoué.");
  }
  return payload as T;
}

let revision = 0;
let cacheGeneration = 0;
let resourceCache = new WeakMap<object, Map<string, unknown>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function refresh() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function clearResourceCache() {
  cacheGeneration += 1;
  resourceCache = new WeakMap();
  refresh();
}

export function useResource<T>(key: string, load: (key: string) => Promise<T>) {
  const version = useSyncExternalStore(subscribe, () => revision, () => 0);
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>();
  const cached = resourceCache.get(load)?.get(key) as T | undefined;
  useEffect(() => {
    if (!key) return;
    let active = true;
    const generation = cacheGeneration;
    void load(key).then(
      (value) => { if (active && generation === cacheGeneration) {
        let cache = resourceCache.get(load);
        if (!cache) { cache = new Map(); resourceCache.set(load, cache); }
        cache.set(key, value);
        setState({ key, value });
      } },
      (error: unknown) => { if (active) setState({ key, error: errorMessage(error) }); },
    );
    return () => { active = false; };
  }, [key, load, version]);
  const current = state?.key === key ? state : undefined;
  return { value: current?.value ?? cached, error: current?.error, loading: !!key && !current && cached === undefined };
}

const getResource = (key: string) => api<unknown>(key);
export function useGet<T>(path: string) {
  return useResource(path, getResource as (key: string) => Promise<T>);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}
