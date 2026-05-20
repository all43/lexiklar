export interface PipelineStep {
  script: string;
  args: string[];
  timeoutMs?: number;
}

export interface PipelineProgress {
  stage: string;
  status: "running" | "done";
  [key: string]: unknown;
}

export interface DataStore {
  // ── Word files ──
  readWord(pos: string, lemma: string): Promise<any>;
  writeWord(pos: string, lemma: string, data: any): Promise<void>;
  wordExists(pos: string, lemma: string): Promise<boolean>;
  listWordFiles(pos: string): Promise<string[]>;
  listPosDirs(): string[];

  // ── Example shards ──
  readExampleShard(prefix: string): Promise<Record<string, any>>;
  writeExampleShard(prefix: string, data: Record<string, any>): Promise<void>;
  listExampleShards(): Promise<string[]>;

  // ── Config files ──
  readWhitelist(): Promise<any>;
  writeWhitelist(data: any): Promise<void>;

  // ── Git operations ──
  getStatus(paths: string[]): Promise<string>;
  addAndCommit(files: string[], message: string): Promise<{ hash: string }>;

  // ── Pipeline scripts ──
  runPipeline(
    steps: PipelineStep[],
    onProgress?: (p: PipelineProgress) => void,
  ): Promise<void>;

  // ── Misc read ──
  fileExists(relativePath: string): Promise<boolean>;
  readFile(relativePath: string): Promise<string>;
}
