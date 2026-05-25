import type { DataStore, PipelineStep, PipelineProgress } from "./data-store.js";

export interface GitHubDataStoreEnv {
  R2: R2Bucket;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "owner/repo"
  GITHUB_BRANCH?: string;
}

const POS_DIRS = [
  "abbreviations", "adjectives", "adverbs", "conjunctions", "determiners",
  "interjections", "names", "nouns", "numerals", "particles", "phrases",
  "postpositions", "prepositions", "pronouns", "verbs",
];

export class GitHubDataStore implements DataStore {
  private r2: R2Bucket;
  private token: string;
  private repo: string;
  private branch: string;
  private baseUrl: string;

  constructor(env: GitHubDataStoreEnv) {
    this.r2 = env.R2;
    this.token = env.GITHUB_TOKEN;
    this.repo = env.GITHUB_REPO;
    this.branch = env.GITHUB_BRANCH || "main";
    this.baseUrl = `https://api.github.com/repos/${this.repo}`;
  }

  private async ghFetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const headers = new Headers(opts.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    if (opts.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(`${this.baseUrl}${path}`, { ...opts, headers });
  }

  private async readFromR2(key: string): Promise<string | null> {
    const obj = await this.r2.get(key);
    if (!obj) return null;
    return obj.text();
  }

  private async readFromGitHub(repoPath: string): Promise<string> {
    const res = await this.ghFetch(`/contents/${encodeURIComponent(repoPath)}?ref=${this.branch}`);
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${repoPath}`);
    const data = await res.json() as { content: string; encoding: string };
    if (data.encoding !== "base64") throw new Error(`Unexpected encoding: ${data.encoding}`);
    return atob(data.content);
  }

  private async readJSON(r2Key: string, repoPath: string): Promise<any> {
    const cached = await this.readFromR2(r2Key);
    if (cached) return JSON.parse(cached);
    const content = await this.readFromGitHub(repoPath);
    await this.r2.put(r2Key, content);
    return JSON.parse(content);
  }

  private async writeToGitHub(repoPath: string, content: string, message: string): Promise<string> {
    // Get current file SHA (needed for updates)
    let sha: string | undefined;
    const getRes = await this.ghFetch(`/contents/${encodeURIComponent(repoPath)}?ref=${this.branch}`);
    if (getRes.ok) {
      const data = await getRes.json() as { sha: string };
      sha = data.sha;
    }

    const body: Record<string, unknown> = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: this.branch,
    };
    if (sha) body.sha = sha;

    const res = await this.ghFetch(`/contents/${encodeURIComponent(repoPath)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub PUT failed ${res.status}: ${err}`);
    }
    const result = await res.json() as { commit: { sha: string } };
    return result.commit.sha;
  }

  // ── Word files ──

  async readWord(pos: string, lemma: string): Promise<any> {
    return this.readJSON(`words/${pos}/${lemma}.json`, `data/words/${pos}/${lemma}.json`);
  }

  async writeWord(pos: string, lemma: string, data: any): Promise<void> {
    const content = JSON.stringify(data, null, 2) + "\n";
    const key = `words/${pos}/${lemma}.json`;
    await this.writeToGitHub(`data/words/${pos}/${lemma}.json`, content, `chore(data): update ${pos}/${lemma}`);
    await this.r2.put(key, content);
  }

  async wordExists(pos: string, lemma: string): Promise<boolean> {
    const obj = await this.r2.head(`words/${pos}/${lemma}.json`);
    if (obj) return true;
    const res = await this.ghFetch(`/contents/data/words/${pos}/${encodeURIComponent(lemma)}.json?ref=${this.branch}`, { method: "HEAD" });
    return res.ok;
  }

  async listWordFiles(pos: string): Promise<string[]> {
    const listKey = `_index/words/${pos}.json`;
    const cached = await this.readFromR2(listKey);
    if (cached) return JSON.parse(cached);

    const res = await this.ghFetch(`/git/trees/${this.branch}:data/words/${pos}`);
    if (!res.ok) return [];
    const tree = await res.json() as { tree: { path: string; type: string }[] };
    const files = tree.tree
      .filter(t => t.type === "blob" && t.path.endsWith(".json"))
      .map(t => t.path);

    await this.r2.put(listKey, JSON.stringify(files));
    return files;
  }

  listPosDirs(): string[] {
    return POS_DIRS;
  }

  // ── Example shards ──

  async readExampleShard(prefix: string): Promise<Record<string, any>> {
    return this.readJSON(`examples/${prefix}.json`, `data/examples/${prefix}.json`);
  }

  async writeExampleShard(prefix: string, data: Record<string, any>): Promise<void> {
    const content = JSON.stringify(data, null, 2) + "\n";
    const key = `examples/${prefix}.json`;
    await this.writeToGitHub(`data/examples/${prefix}.json`, content, `chore(data): update example shard ${prefix}`);
    await this.r2.put(key, content);
  }

  async listExampleShards(): Promise<string[]> {
    const listKey = `_index/examples.json`;
    const cached = await this.readFromR2(listKey);
    if (cached) return JSON.parse(cached);

    const res = await this.ghFetch(`/git/trees/${this.branch}:data/examples`);
    if (!res.ok) return [];
    const tree = await res.json() as { tree: { path: string; type: string }[] };
    const files = tree.tree
      .filter(t => t.type === "blob" && t.path.endsWith(".json"))
      .map(t => t.path)
      .sort();

    await this.r2.put(listKey, JSON.stringify(files));
    return files;
  }

  // ── Config files ──

  async readWhitelist(): Promise<any> {
    return this.readJSON("config/word-whitelist.json", "config/word-whitelist.json");
  }

  async writeWhitelist(data: any): Promise<void> {
    const content = JSON.stringify(data, null, 2) + "\n";
    await this.writeToGitHub("config/word-whitelist.json", content, "chore(config): update word whitelist");
    await this.r2.put("config/word-whitelist.json", content);
  }

  // ── Git operations ──

  async getStatus(_paths: string[]): Promise<string> {
    // In GitHub mode, "uncommitted" = changes since last commit on branch.
    // We compare HEAD to HEAD~1, or track dirty state via R2 metadata.
    // For now, return the dirty set tracked during writes.
    const dirtyKey = "_meta/dirty-files.json";
    const cached = await this.readFromR2(dirtyKey);
    if (!cached) return "";
    const files: string[] = JSON.parse(cached);
    return files.map(f => ` M ${f}`).join("\n");
  }

  async addAndCommit(files: string[], message: string): Promise<{ hash: string }> {
    // Batch commit using Git Trees API
    const headRes = await this.ghFetch(`/git/ref/heads/${this.branch}`);
    if (!headRes.ok) throw new Error("Failed to get HEAD ref");
    const headData = await headRes.json() as { object: { sha: string } };
    const headSha = headData.object.sha;

    const commitRes = await this.ghFetch(`/git/commits/${headSha}`);
    if (!commitRes.ok) throw new Error("Failed to get HEAD commit");
    const commitData = await commitRes.json() as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // Collect blobs for files that exist in R2 (were written during this session)
    const treeItems: { path: string; mode: string; type: string; content: string }[] = [];
    for (const pattern of files) {
      // Handle glob patterns by checking R2 for matching files
      if (pattern.includes("*")) {
        const prefix = pattern.split("*")[0];
        const r2Prefix = prefix.replace(/^data\//, "").replace(/^config\//, "config/");
        const listed = await this.r2.list({ prefix: r2Prefix });
        for (const obj of listed.objects) {
          const content = await (await this.r2.get(obj.key))?.text();
          if (content) {
            const repoPath = obj.key.startsWith("config/") ? obj.key : `data/${obj.key}`;
            treeItems.push({ path: repoPath, mode: "100644", type: "blob", content });
          }
        }
      } else {
        const r2Key = pattern.replace(/^data\//, "").replace(/^config\//, "config/");
        const content = await this.readFromR2(r2Key);
        if (content) {
          treeItems.push({ path: pattern, mode: "100644", type: "blob", content });
        }
      }
    }

    if (!treeItems.length) throw new Error("no changes to commit");

    // Create tree
    const treeRes = await this.ghFetch("/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!treeRes.ok) throw new Error("Failed to create tree");
    const treeData = await treeRes.json() as { sha: string };

    // Create commit
    const newCommitRes = await this.ghFetch("/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [headSha],
      }),
    });
    if (!newCommitRes.ok) throw new Error("Failed to create commit");
    const newCommitData = await newCommitRes.json() as { sha: string };

    // Update branch ref
    const updateRefRes = await this.ghFetch(`/git/refs/heads/${this.branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommitData.sha }),
    });
    if (!updateRefRes.ok) throw new Error("Failed to update branch ref");

    // Clear dirty tracking
    await this.r2.delete("_meta/dirty-files.json");

    return { hash: newCommitData.sha.slice(0, 7) };
  }

  // ── Pipeline scripts (GitHub Actions) ──

  async runPipeline(
    steps: PipelineStep[],
    onProgress?: (p: PipelineProgress) => void,
  ): Promise<void> {
    // Trigger repository_dispatch
    const res = await this.ghFetch("/dispatches", {
      method: "POST",
      body: JSON.stringify({
        event_type: "admin-pipeline",
        client_payload: { steps },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to trigger pipeline: ${err}`);
    }

    onProgress?.({ stage: "pipeline", status: "running" });

    // Poll for workflow completion
    const startTime = Date.now();
    const timeout = Math.max(...steps.map(s => s.timeoutMs || 60_000)) + 60_000;

    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, 5_000));

      const runsRes = await this.ghFetch(
        `/actions/runs?event=repository_dispatch&branch=${this.branch}&per_page=1`,
      );
      if (!runsRes.ok) continue;
      const runsData = await runsRes.json() as { workflow_runs: { status: string; conclusion: string | null }[] };
      const latest = runsData.workflow_runs[0];
      if (!latest) continue;

      if (latest.status === "completed") {
        if (latest.conclusion === "success") {
          onProgress?.({ stage: "pipeline", status: "done" });
          // Invalidate R2 cache for affected files
          await this.invalidateWordIndex();
          return;
        }
        throw new Error(`Pipeline failed: ${latest.conclusion}`);
      }
    }

    throw new Error("Pipeline timed out");
  }

  // ── Temp files ──

  async writeTempFile(name: string, content: string): Promise<string> {
    // In Worker context, store in R2 as ephemeral key
    const key = `_temp/${name}-${Date.now()}.txt`;
    await this.r2.put(key, content);
    return key;
  }

  async deleteTempFile(path: string): Promise<void> {
    await this.r2.delete(path);
  }

  // ── Misc ──

  async fileExists(relativePath: string): Promise<boolean> {
    const r2Key = relativePath.replace(/^data\//, "");
    const obj = await this.r2.head(r2Key);
    if (obj) return true;
    const res = await this.ghFetch(`/contents/${encodeURIComponent(relativePath)}?ref=${this.branch}`, { method: "HEAD" });
    return res.ok;
  }

  async readFile(relativePath: string): Promise<string> {
    const r2Key = relativePath.replace(/^data\//, "");
    const cached = await this.readFromR2(r2Key);
    if (cached) return cached;
    return this.readFromGitHub(relativePath);
  }

  // ── Cache management ──

  async invalidateWordIndex(): Promise<void> {
    const listed = await this.r2.list({ prefix: "_index/words/" });
    for (const obj of listed.objects) {
      await this.r2.delete(obj.key);
    }
    await this.r2.delete("_index/examples.json");
  }

  async syncFileFromGitHub(repoPath: string): Promise<void> {
    const content = await this.readFromGitHub(repoPath);
    let r2Key: string;
    if (repoPath.startsWith("data/words/")) {
      r2Key = repoPath.replace("data/", "");
    } else if (repoPath.startsWith("data/examples/")) {
      r2Key = repoPath.replace("data/", "");
    } else if (repoPath.startsWith("config/")) {
      r2Key = repoPath;
    } else {
      r2Key = repoPath;
    }
    await this.r2.put(r2Key, content);
  }
}
