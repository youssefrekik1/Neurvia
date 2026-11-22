"use client";
// Demo mode: runs the app on fictional data in the browser, with no backend or account.
// Enable from the login page ("Lancer la démo") or by visiting /demo/teacher or /demo/student.

export type DemoRole = "teacher" | "student";
const KEY = "neurvia.demo";

export function demoRole(): DemoRole | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(KEY);
  return value === "teacher" || value === "student" ? value : null;
}

export function startDemo(role: DemoRole) {
  localStorage.setItem(KEY, role);
  window.location.assign(role === "teacher" ? "/teacher/cockpit" : "/student/parcours");
}

export function stopDemo() {
  localStorage.removeItem(KEY);
  window.location.assign("/login");
}

const CLASSROOM = { id: "00000000-0000-4000-8000-0000000000a1", name: "L1 Informatique A", subject: "Algorithmique & Python", is_synthetic: true };
const CLASSROOM_B = { id: "00000000-0000-4000-8000-0000000000b1", name: "L1 Informatique B", subject: "Algorithmique & Python", is_synthetic: true };

function profile(role: DemoRole) {
  return role === "teacher"
    ? { id: "00000000-0000-4000-8000-000000000001", email: "amel.bensalem.prof@neurvia.demo", full_name: "Amel Ben Salem", role, is_synthetic: true }
    : { id: "00000000-0000-4000-8000-000000000002", email: "nour.02.a@neurvia.demo", full_name: "Nour Mabrouk", role, is_synthetic: true };
}

/** Returns a mocked payload, or undefined to let the request reach the real backend. */
export function mockResponse(path: string, method: string): unknown {
  const role = demoRole();
  if (!role) return undefined;
  const route = path.split("?")[0];
  if (route === "/me") return profile(role);
  if (route === "/classrooms" && method === "GET") return role === "teacher" ? [CLASSROOM, CLASSROOM_B] : [CLASSROOM];
  if (route === "/auth/logout") { localStorage.removeItem(KEY); return { ok: true }; }
  return undefined;
}
