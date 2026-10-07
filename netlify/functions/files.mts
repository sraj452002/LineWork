import { getUser } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

// Each signed-in person's files, one JSON blob per file, keyed "<user id>/<file id>".
// The user id comes from the verified Identity session, so nobody can read or write another person's files.
const MAX_BYTES = 4_000_000;
const ID = /^[\w-]{1,80}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request, context: Context) => {
  const user = await getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  // Changes must come from this site (blocks cross-site form posts riding on the session cookie).
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return json({ error: "forbidden" }, 403);
  }

  const store = getStore({ name: "linework-files", consistency: "strong" });
  const prefix = `${user.id}/`;
  const id = context.params?.id;

  if (!id) {
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const { blobs } = await store.list({ prefix });
    const files = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" }).catch(() => null)));
    return json({ files: files.filter(Boolean) });
  }

  if (!ID.test(id)) return json({ error: "bad_id" }, 400);
  const key = prefix + id;

  if (req.method === "GET") {
    const file = await store.get(key, { type: "json" });
    return file ? json(file) : json({ error: "not_found" }, 404);
  }
  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "too_large" }, 413);
    let file: { id?: unknown; diagrams?: unknown };
    try { file = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400); }
    if (!file || file.id !== id || !Array.isArray(file.diagrams)) return json({ error: "bad_file" }, 400);
    await store.set(key, text);
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await store.delete(key);
    return json({ ok: true });
  }
  return json({ error: "method_not_allowed" }, 405);
};

export const config: Config = { path: ["/api/files", "/api/files/:id"] };
