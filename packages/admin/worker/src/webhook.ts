import { GitHubDataStore } from "../../server/github-data-store.js";
import type { Env } from "./index.js";

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const event = request.headers.get("X-GitHub-Event");
  if (event !== "push") {
    return new Response("Ignored event", { status: 200 });
  }

  const body = await request.json() as PushEvent;

  // Only process pushes to our branch
  const branch = env.GITHUB_BRANCH || "main";
  if (body.ref !== `refs/heads/${branch}`) {
    return new Response("Ignored branch", { status: 200 });
  }

  const store = new GitHubDataStore({
    R2: env.R2,
    GITHUB_TOKEN: env.GITHUB_TOKEN,
    GITHUB_REPO: env.GITHUB_REPO,
    GITHUB_BRANCH: branch,
  });

  // Collect all changed files across commits
  const changedFiles = new Set<string>();
  for (const commit of body.commits || []) {
    for (const f of commit.added || []) changedFiles.add(f);
    for (const f of commit.modified || []) changedFiles.add(f);
    // Don't sync removed files — just invalidate indexes
  }

  // Sync relevant files to R2
  let synced = 0;
  const indexInvalidated = new Set<string>();

  for (const file of changedFiles) {
    try {
      if (file.startsWith("data/words/") && file.endsWith(".json")) {
        await store.syncFileFromGitHub(file);
        synced++;
        const posDir = file.split("/")[2];
        indexInvalidated.add(`_index/words/${posDir}.json`);
      } else if (file.startsWith("data/examples/") && file.endsWith(".json")) {
        await store.syncFileFromGitHub(file);
        synced++;
        indexInvalidated.add("_index/examples.json");
      } else if (file === "config/word-whitelist.json") {
        await store.syncFileFromGitHub(file);
        synced++;
      }
    } catch (err) {
      console.error(`Failed to sync ${file}:`, err);
    }
  }

  // Invalidate directory indexes that were affected
  for (const key of indexInvalidated) {
    await env.R2.delete(key);
  }

  // Handle removed files
  const removedFiles = new Set<string>();
  for (const commit of body.commits || []) {
    for (const f of commit.removed || []) removedFiles.add(f);
  }
  for (const file of removedFiles) {
    let r2Key: string | null = null;
    if (file.startsWith("data/words/") && file.endsWith(".json")) {
      r2Key = file.replace("data/", "");
    } else if (file.startsWith("data/examples/") && file.endsWith(".json")) {
      r2Key = file.replace("data/", "");
    } else if (file === "config/word-whitelist.json") {
      r2Key = file;
    }
    if (r2Key) {
      await env.R2.delete(r2Key);
    }
  }

  return new Response(JSON.stringify({ synced, removed: removedFiles.size }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface PushEvent {
  ref: string;
  commits: {
    added: string[];
    modified: string[];
    removed: string[];
  }[];
}
