/**
 * Cloudflare Worker — Lexiklar Data Report Proxy
 *
 * Receives user reports (missing words, incorrect data) and creates
 * GitHub Issues in the lexiklar repository.
 *
 * Secrets (set via `wrangler secret put`):
 *   GITHUB_TOKEN  — GitHub PAT with `repo` scope
 *
 * Environment variables (set in wrangler.toml):
 *   GITHUB_OWNER  — e.g. "evgeniimalikov"
 *   GITHUB_REPO   — e.g. "lexiklar"
 *
 * Deploy:
 *   npx wrangler deploy workers/report-worker.js --name lexiklar-reports
 *
 * Usage:
 *   POST /report
 *   {
 *     "type": "missing_word" | "incorrect_data",
 *     "word": "Katze",
 *     "details": "optional description",
 *     "file": "nouns/Tisch",        // for incorrect_data
 *     "appVersion": "1.0.0",
 *     "dbVersion": "56c3818c"
 *   }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Simple in-memory rate limiting (resets on worker restart, per isolate)
const rateLimits = new Map();
const RATE_LIMIT = 10; // max reports per window
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateLimits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/report" || request.method !== "POST") {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    // Rate limiting
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (isRateLimited(ip)) {
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

    // Build GitHub issue
    const isMissing = type === "missing_word";
    const title = isMissing
      ? `[Missing] ${word}`
      : `[Data] ${word}${file ? ` (${file})` : ""}`;

    const bodyParts = [];
    if (details) bodyParts.push(details);
    bodyParts.push("");
    bodyParts.push("---");
    bodyParts.push(`**Type**: ${type}`);
    bodyParts.push(`**Word**: ${word}`);
    if (file) bodyParts.push(`**File**: \`${file}\``);
    if (appVersion) bodyParts.push(`**App version**: ${appVersion}`);
    if (dbVersion) bodyParts.push(`**DB version**: ${dbVersion}`);

    const labels = ["data-report"];
    labels.push(isMissing ? "missing-word" : "incorrect-data");

    try {
      const ghResp = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "lexiklar-report-worker",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            body: bodyParts.join("\n"),
            labels,
          }),
        },
      );

      if (!ghResp.ok) {
        const text = await ghResp.text();
        console.error("GitHub API error:", ghResp.status, text);
        return Response.json(
          { ok: false, error: "Failed to create issue" },
          { status: 502, headers: CORS_HEADERS },
        );
      }

      return Response.json({ ok: true }, { headers: CORS_HEADERS });
    } catch (err) {
      console.error("GitHub API request failed:", err);
      return Response.json(
        { ok: false, error: "Internal error" },
        { status: 500, headers: CORS_HEADERS },
      );
    }
  },
};
