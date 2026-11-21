export type Role = "teacher" | "student";

const roleKey = "neurvia.demo.role";

function validRole(value: string | null): Role | null {
  return value === "teacher" || value === "student" ? value : null;
}

export function getRole(): Role | null {
  if (typeof window === "undefined") return null;
  return (
    validRole(sessionStorage.getItem(roleKey)) ??
    validRole(localStorage.getItem(roleKey))
  );
}

export function login(role: Role, remember: boolean): void {
  logout();
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(roleKey, role);
}

export function logout(): void {
  localStorage.removeItem(roleKey);
  sessionStorage.removeItem(roleKey);
}
