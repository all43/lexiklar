/**
 * Cloudflare Worker — Lexiklar Data Report Store
 *
 * Receives user reports (missing words, incorrect data) and stores
 * them privately in Cloudflare KV.
 *
 * Deploy:
 *   cd workers && npx wrangler deploy
 *
 * View reports:
 *   GET /reports (returns all stored reports as JSON)
 *
 * Submit report:
 *   POST /report
 *   {
 *     "type": "missing_word" | "incorrect_data",
 *     "word": "Katze",
 *     "details": "optional description",
 *     "file": "nouns/Tisch",
 *     "appVersion": "1.0.0",
 *     "dbVersion": "56c3818c"
 *   }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const RATE_LIMIT = 100; // max reports per window
const RATE_WINDOW_SEC = 3600; // 1 hour

async function isRateLimited(ip, kv) {
  const key = `rate:${ip}`;
  const entry = await kv.get(key, "json");
  const now = Date.now();
  if (!entry || now - entry.start > RATE_WINDOW_SEC * 1000) {
    await kv.put(key, JSON.stringify({ start: now, count: 1 }), { expirationTtl: RATE_WINDOW_SEC });
    return false;
  }
  entry.count++;
  await kv.put(key, JSON.stringify(entry), { expirationTtl: RATE_WINDOW_SEC });
  return entry.count > RATE_LIMIT;
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // List reports (admin only — requires Bearer token)
    if (url.pathname === "/reports" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
        return Response.json(
          { ok: false, error: "Unauthorized" },
          { status: 401, headers: CORS_HEADERS },
        );
      }
      const list = await env.RATE_LIMITS.list({ prefix: "report:" });
      const reports = [];
      for (const key of list.keys) {
        const value = await env.RATE_LIMITS.get(key.name, "json");
        if (value) reports.push(value);
      }
      reports.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      return Response.json(reports, { headers: CORS_HEADERS });
    }

    if (url.pathname !== "/report" || request.method !== "POST") {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    // Rate limiting
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await isRateLimited(ip, env.RATE_LIMITS)) {
      return Response.json(
        { ok: false, error: "Too many reports. Please try again later." },
        { status: 429, headers: CORS_HEADERS },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: "Invalid JSON" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const { type, word, details, file, appVersion, dbVersion } = body;

    if (!type || !word) {
      return Response.json(
        { ok: false, error: "Missing required fields: type, word" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Store report in KV
    const ts = Date.now();
    const id = `report:${ts}:${Math.random().toString(36).slice(2, 8)}`;
    const report = {
      id,
      ts,
      type,
      word,
      details: details || null,
      file: file || null,
      appVersion: appVersion || null,
      dbVersion: dbVersion || null,
    };

    try {
      await env.RATE_LIMITS.put(id, JSON.stringify(report));
      return Response.json({ ok: true }, { headers: CORS_HEADERS });
    } catch (err) {
      console.error("KV write failed:", err);
      return Response.json(
        { ok: false, error: "Internal error" },
        { status: 500, headers: CORS_HEADERS },
      );
    }
  },
};
