import { api, type Schema } from "../lib/api";

export type Role = Schema["Role"];

export async function login(email: string, password: string, remember: boolean) {
  await api("/auth/login" + (remember ? "?remember=1" : ""), "POST", { email, password });
  return api<Schema["Profile"]>("/me");
}

export async function register(data: Schema["Register"]) {
  return api<Schema["Profile"]>("/auth/register", "POST", data);
}

export async function logout() {
  return api("/auth/logout", "POST");
}
