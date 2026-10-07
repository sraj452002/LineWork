import type { Config } from "@netlify/edge-functions";

// Proxies AI requests to Anthropic so the API key stays on the server.
export default async (req: Request) => {
  const url = new URL(req.url);
  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

  if (url.pathname === "/api/ai/status") return json({ enabled: Boolean(key) });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
  if (!key) return json({ error: "not_configured" }, 503);

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt) return json({ error: "bad_request" }, 400);
  if (prompt.length > 400_000) return json({ error: "too_large" }, 413);

  // Optional pictures (a photo or screenshot of a diagram), sent before the text.
  const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const images = Array.isArray(body?.images) ? body.images : [];
  if (images.length > 4) return json({ error: "too_many_images" }, 413);
  for (const im of images) {
    if (!IMAGE_TYPES.includes(im?.media_type) || typeof im?.data !== "string") return json({ error: "bad_image" }, 400);
    if (im.data.length > 6_000_000) return json({ error: "too_large" }, 413);
  }
  const content = images.length
    ? [...images.map((im: { media_type: string; data: string }) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })), { type: "text", text: prompt }]
    : prompt;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Netlify.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: 8000,
      stream: true,
      messages: [{ role: "user", content }],
    }),
  });
  if (!upstream.ok || !upstream.body) {
    console.log("Anthropic API error", upstream.status, await upstream.text().catch(() => ""));
    return json({ error: "upstream" }, upstream.status === 429 || upstream.status === 529 ? 429 : 502);
  }
  return new Response(upstream.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
};

export const config: Config = { path: ["/api/ai", "/api/ai/status"] };
