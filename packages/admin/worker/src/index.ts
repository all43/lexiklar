import { GitHubDataStore } from "../../server/github-data-store.js";
import type { DataStore } from "../../server/data-store.js";
import { handleApiRequest } from "./api-handlers.js";
import { handleWebhook } from "./webhook.js";

export interface Env {
  R2: R2Bucket;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  ADMIN_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Webhook endpoint (no auth — validated via GitHub signature)
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    // API routes require auth
    if (url.pathname.startsWith("/api/")) {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || authHeader !== `Bearer ${env.ADMIN_AUTH_TOKEN}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const store: DataStore = new GitHubDataStore({
        R2: env.R2,
        GITHUB_TOKEN: env.GITHUB_TOKEN,
        GITHUB_REPO: env.GITHUB_REPO,
        GITHUB_BRANCH: env.GITHUB_BRANCH || "main",
      });

      return handleApiRequest(request, url, store, env);
    }

    // Serve static assets (admin Vue app)
    return env.ASSETS.fetch(request);
  },
};
