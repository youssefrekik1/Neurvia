import { api, clearResourceCache, type Schema } from "../lib/api";

export type Role = Schema["Role"];

export async function login(email: string, password: string, remember: boolean) {
  clearResourceCache();
  await api("/auth/login" + (remember ? "?remember=1" : ""), "POST", { email, password });
  return api<Schema["Profile"]>("/me");
}

export async function register(data: Schema["Register"]) {
  return api<Schema["Profile"]>("/auth/register", "POST", data);
}

export async function logout() {
  const result = await api("/auth/logout", "POST");
  clearResourceCache();
  return result;
}
