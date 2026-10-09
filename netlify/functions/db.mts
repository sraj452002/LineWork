import { getUser } from "@netlify/identity";
import type { Config } from "@netlify/functions";
// @ts-ignore: plain JavaScript, shared with the Linework server
import { DbError, handle } from "../../server/dbconnect.js";

// The Database view's connections (see server/dbconnect.js). Signed-in people only. Databases on private
// networks are refused unless DB_ALLOW_PRIVATE=1; queries stop after 9 seconds, inside Netlify's 10-second limit.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request) => {
  const user = await getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "forbidden" }, 403);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  try {
    return json(await handle(body, { allowPrivate: process.env.DB_ALLOW_PRIVATE === "1", timeout: 9000 }));
  } catch (e) {
    const err = e as { code?: string; status?: number; message?: string };
    return json({ error: err.code || "db_error", message: e instanceof DbError ? err.message : "The database request failed." }, e instanceof DbError ? err.status : 500);
  }
};

export const config: Config = { path: "/api/db" };
