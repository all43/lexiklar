import {
  readdirSync, readFileSync, writeFileSync, existsSync,
} from "fs";
import { join, resolve } from "path";
import { spawn, execFileSync } from "child_process";
import type { DataStore, PipelineStep, PipelineProgress } from "./data-store.js";

const ROOT = resolve(__dirname, "../../..");
const WORDS_DIR = join(ROOT, "data", "words");
const EXAMPLES_DIR = join(ROOT, "data", "examples");
const TSX_BIN = resolve(ROOT, "node_modules/.bin/tsx");

const POS_DIRS = [
  "abbreviations", "adjectives", "adverbs", "conjunctions", "determiners",
  "interjections", "names", "nouns", "numerals", "particles", "phrases",
  "postpositions", "prepositions", "pronouns", "verbs",
];

function runScript(script: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(TSX_BIN, [script, ...args], { cwd: ROOT, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`Timeout after ${timeoutMs / 1000}s`)); }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `exited with code ${code}`));
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

export class LocalDataStore implements DataStore {
  // ── Word files ──

  async readWord(pos: string, lemma: string): Promise<any> {
    const p = join(WORDS_DIR, pos, lemma + ".json");
    return JSON.parse(readFileSync(p, "utf-8"));
  }

  async writeWord(pos: string, lemma: string, data: any): Promise<void> {
    const p = join(WORDS_DIR, pos, lemma + ".json");
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  async wordExists(pos: string, lemma: string): Promise<boolean> {
    return existsSync(join(WORDS_DIR, pos, lemma + ".json"));
  }

  async listWordFiles(pos: string): Promise<string[]> {
    const dirPath = join(WORDS_DIR, pos);
    if (!existsSync(dirPath)) return [];
    return readdirSync(dirPath).filter(f => f.endsWith(".json"));
  }

  listPosDirs(): string[] {
    return POS_DIRS;
  }

  // ── Example shards ──

  async readExampleShard(prefix: string): Promise<Record<string, any>> {
    const p = join(EXAMPLES_DIR, prefix + ".json");
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  }

  async writeExampleShard(prefix: string, data: Record<string, any>): Promise<void> {
    const p = join(EXAMPLES_DIR, prefix + ".json");
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  async listExampleShards(): Promise<string[]> {
    return readdirSync(EXAMPLES_DIR).filter(f => f.endsWith(".json")).sort();
  }

  // ── Config files ──

  async readWhitelist(): Promise<any> {
    const p = join(ROOT, "config", "word-whitelist.json");
    return JSON.parse(readFileSync(p, "utf-8"));
  }

  async writeWhitelist(data: any): Promise<void> {
    const p = join(ROOT, "config", "word-whitelist.json");
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  // ── Git operations ──

  async getStatus(paths: string[]): Promise<string> {
    const gitOpts = { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 };
    return execFileSync("git", ["status", "--porcelain", "--", ...paths], gitOpts).toString();
  }

  async addAndCommit(files: string[], message: string): Promise<{ hash: string }> {
    const gitOpts = { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 };
    execFileSync("git", ["add", "--", ...files], gitOpts);
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], gitOpts).toString().trim();
    if (!staged) throw new Error("no changes to commit");
    execFileSync("git", ["commit", "-m", message], gitOpts);
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], gitOpts).toString().trim();
    return { hash };
  }

  // ── Pipeline scripts ──

  async runPipeline(
    steps: PipelineStep[],
    onProgress?: (p: PipelineProgress) => void,
  ): Promise<void> {
    for (const step of steps) {
      const scriptPath = resolve(ROOT, `scripts/${step.script}.ts`);
      onProgress?.({ stage: step.script, status: "running" });
      await runScript(scriptPath, step.args, step.timeoutMs ?? 60_000);
      onProgress?.({ stage: step.script, status: "done" });
    }
  }

  // ── Misc ──

  async fileExists(relativePath: string): Promise<boolean> {
    return existsSync(join(ROOT, relativePath));
  }

  async readFile(relativePath: string): Promise<string> {
    return readFileSync(join(ROOT, relativePath), "utf-8");
  }
}
