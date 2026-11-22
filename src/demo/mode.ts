"use client";
// Demo mode: runs the app on fictional data in the browser, with no backend or account.
// Enable it from the login page with « Lancer la démo ». The fictional API lives in ./backend.ts.

import { demoBackend, resetDemoState } from "./backend";

export type DemoRole = "teacher" | "student";
const KEY = "neurvia.demo";

export function demoRole(): DemoRole | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(KEY);
  return value === "teacher" || value === "student" ? value : null;
}

export function startDemo(role: DemoRole) {
  if (!demoRole()) resetDemoState(); // fresh data when the demo starts from the login page
  localStorage.setItem(KEY, role);
  window.location.href = role === "teacher" ? "/teacher/cockpit" : "/student/parcours";
}

export function stopDemo() {
  localStorage.removeItem(KEY);
  resetDemoState();
  // A full reload drops every cached demo response before returning to the real login.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}

function profile(role: DemoRole) {
  return role === "teacher"
    ? { id: "00000000-0000-4000-8000-000000000001", email: "hela.benamor@neurvia.tn", full_name: "Hela Ben Amor", role, is_synthetic: true }
    : { id: "00000000-0000-4000-8000-000000000002", email: "yassine.jaziri@neurvia.tn", full_name: "Yassine Jaziri", role, is_synthetic: true };
}

/** Returns a mocked payload, or undefined to let the request reach the real backend. */
export function mockResponse(path: string, method: string, data?: unknown): unknown {
  const role = demoRole();
  if (!role) return undefined;
  const [route, search = ""] = path.split("?");
  if (route === "/me") return profile(role);
  if (route === "/auth/logout") { localStorage.removeItem(KEY); return { ok: true }; }
  return demoBackend(route, method, data, role, new URLSearchParams(search));
}
