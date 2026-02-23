import { createWriteStream, existsSync, statSync } from "fs";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_DIR = join(ROOT, "data", "raw");
const OUTPUT = join(RAW_DIR, "de-extract.jsonl");
const GZ_URL =
  "https://kaikki.org/dictionary/downloads/de/de-extract.jsonl.gz";

async function download() {
  if (existsSync(OUTPUT)) {
    const sizeMB = (statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
    console.log(`de-extract.jsonl already exists (${sizeMB} MB). Skipping download.`);
    console.log("Delete it manually to re-download.");
    return;
  }

  console.log(`Downloading ${GZ_URL} ...`);
  const res = await fetch(GZ_URL);

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const totalBytes = Number(res.headers.get("content-length") || 0);
  let downloadedBytes = 0;
  let lastPercent = -1;

  const progress = new TransformStream({
    transform(chunk, controller) {
      downloadedBytes += chunk.byteLength;
      if (totalBytes > 0) {
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        if (percent !== lastPercent && percent % 5 === 0) {
          lastPercent = percent;
          const dlMB = (downloadedBytes / 1024 / 1024).toFixed(1);
          const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${dlMB} / ${totalMB} MB (${percent}%)`);
        }
      }
      controller.enqueue(chunk);
    },
  });

  const gunzip = createGunzip();
  const out = createWriteStream(OUTPUT);

  // Web ReadableStream → progress → Node stream → gunzip → file
  const webStream = res.body.pipeThrough(progress);
  const nodeStream = ReadableStream.toNodeStream
    ? ReadableStream.toNodeStream(webStream)
    : (await import("stream")).Readable.fromWeb(webStream);

  await pipeline(nodeStream, gunzip, out);

  const sizeMB = (statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
  console.log(`\nDone. Decompressed to ${OUTPUT} (${sizeMB} MB)`);
}

download().catch((err) => {
  console.error("Download failed:", err.message);
  process.exit(1);
});
