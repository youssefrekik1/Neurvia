import { NextRequest, NextResponse } from "next/server";

const sessionCookie = "neurvia_session";
const allowed = new Set(["auth", "me", "classrooms", "institutions", "taxonomy", "lessons",
  "quizzes", "attempts", "bank", "groups", "interventions", "demo"]);
const noCache = { "Cache-Control": "no-store" };

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noCache });
}

async function proxy(request: NextRequest, context: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await context.params;
  if (!allowed.has(segments[0]) || segments.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part)))
    return error(404, "RESOURCE_NOT_FOUND", "Ressource introuvable.");
  const path = segments.join("/");
  const expectedOrigin = request.nextUrl.protocol + "//" + request.headers.get("host");
  if (request.method !== "GET" && request.headers.get("origin") !== expectedOrigin)
    return error(403, "INVALID_ORIGIN", "Origine de la requête non autorisée.");
  if (path === "auth/logout" && request.method === "POST") {
    const response = NextResponse.json({ signed_out: true }, { headers: noCache });
    response.cookies.delete(sessionCookie);
    return response;
  }

  const base = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
  const headers = new Headers();
  const token = request.cookies.get(sessionCookie)?.value;
  if (token) headers.set("Authorization", "Bearer " + token);
  const body = request.body ?? undefined;
  const contentType = request.headers.get("Content-Type");
  if (body && contentType) headers.set("Content-Type", contentType);
  const length = Number(request.headers.get("Content-Length"));
  if (length > 65 * 1024 * 1024)
    return error(413, "PAYLOAD_TOO_LARGE", "Le fichier est trop volumineux.");
  try {
    const options: RequestInit & { duplex?: "half" } = {
      method: request.method, headers, body, cache: "no-store", redirect: "error",
      ...(body && { duplex: "half" }),
    };
    const upstream = await fetch(base + "/" + path + request.nextUrl.search, options);
    if (path === "auth/login" && upstream.ok) {
      const result = await upstream.json() as { access_token: string; expires_in: number };
      const response = NextResponse.json({ signed_in: true }, { headers: noCache });
      response.cookies.set(sessionCookie, result.access_token, {
        httpOnly: true, secure: request.nextUrl.protocol === "https:",
        sameSite: "lax", path: "/",
        ...(request.nextUrl.searchParams.get("remember") === "1" && { maxAge: result.expires_in }),
      });
      return response;
    }
    const outgoing = new Headers(noCache);
    for (const name of ["Content-Type", "Content-Disposition", "X-Content-Type-Options"]) {
      const value = upstream.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    const response = new NextResponse(upstream.body, { status: upstream.status, headers: outgoing });
    if (upstream.status === 401) response.cookies.delete(sessionCookie);
    return response;
  } catch {
    return error(502, "BACKEND_UNAVAILABLE", "Le serveur FAHM est momentanément inaccessible.");
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
