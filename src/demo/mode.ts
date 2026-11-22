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

const CLASSROOM = { id: "00000000-0000-4000-8000-0000000000a1", name: "Bases de données · L2 Informatique A", subject: "Bases de données", is_synthetic: true };
const CLASSROOM_B = { id: "00000000-0000-4000-8000-0000000000b1", name: "Mathématiques du signal · L2 Informatique A", subject: "Mathématiques du signal", is_synthetic: true };

function profile(role: DemoRole) {
  return role === "teacher"
    ? { id: "00000000-0000-4000-8000-000000000001", email: "hela.benamor@neurvia.tn", full_name: "Hela Ben Amor", role, is_synthetic: true }
    : { id: "00000000-0000-4000-8000-000000000002", email: "yassine.jaziri@neurvia.tn", full_name: "Yassine Jaziri", role, is_synthetic: true };
}

/** Returns a mocked payload, or undefined to let the request reach the real backend. */
export function mockResponse(path: string, method: string): unknown {
  const role = demoRole();
  if (!role) return undefined;
  const route = path.split("?")[0];
  if (route === "/me") return profile(role);
  if (route === "/classrooms" && method === "GET") return [CLASSROOM, CLASSROOM_B];
  if (route === "/auth/logout") { localStorage.removeItem(KEY); return { ok: true }; }
  return undefined;
}
