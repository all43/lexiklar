import { createWriteStream, existsSync, statSync } from "fs";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const ROOT: string = join(__dirname, "..");
const RAW_DIR: string = join(ROOT, "data", "raw");
const OUTPUT: string = join(RAW_DIR, "de-extract.jsonl");
const GZ_URL: string =
  "https://kaikki.org/dictionary/downloads/de/de-extract.jsonl.gz";

async function download(): Promise<void> {
  if (existsSync(OUTPUT)) {
    const sizeMB: string = (statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
    console.log(`de-extract.jsonl already exists (${sizeMB} MB). Skipping download.`);
    console.log("Delete it manually to re-download.");
    return;
  }

  console.log(`Downloading ${GZ_URL} ...`);
  const res: Response = await fetch(GZ_URL);

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const totalBytes: number = Number(res.headers.get("content-length") || 0);
  let downloadedBytes = 0;
  let lastPercent = -1;

  const progress = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>): void {
      downloadedBytes += chunk.byteLength;
      if (totalBytes > 0) {
        const percent: number = Math.floor((downloadedBytes / totalBytes) * 100);
        if (percent !== lastPercent && percent % 5 === 0) {
          lastPercent = percent;
          const dlMB: string = (downloadedBytes / 1024 / 1024).toFixed(1);
          const totalMB: string = (totalBytes / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${dlMB} / ${totalMB} MB (${percent}%)`);
        }
      }
      controller.enqueue(chunk);
    },
  });

  const gunzip = createGunzip();
  const out = createWriteStream(OUTPUT);

  // Web ReadableStream → progress → Node stream → gunzip → file
  const webStream: ReadableStream<Uint8Array> = res.body!.pipeThrough(progress);
  const nodeStream: Readable = Readable.fromWeb(webStream as import("stream/web").ReadableStream);

  await pipeline(nodeStream, gunzip, out);

  const sizeMB: string = (statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
  console.log(`\nDone. Decompressed to ${OUTPUT} (${sizeMB} MB)`);
}

download().catch((err: Error) => {
  console.error("Download failed:", err.message);
  process.exit(1);
});
