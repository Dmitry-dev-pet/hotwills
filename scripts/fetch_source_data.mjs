import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOT = "https://oreanor.github.io/yesteryear";
const DATA_URL = `${SOURCE_ROOT}/data/data.json`;
const IMG_ROOT = `${SOURCE_ROOT}/img`;

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(projectRoot, "data", "source");
const outImagesDir = path.join(outDir, "images");
const outDataPath = path.join(outDir, "data.json");
const outManifestPath = path.join(outDir, "manifest.json");

async function ensureDirs() {
  await fs.mkdir(outImagesDir, { recursive: true });
}

async function fetchJson() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${DATA_URL}: ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Expected data.json to contain an array");
  }

  return payload;
}

async function downloadImage(filename) {
  if (!filename) return { filename, status: "skipped-empty" };

  const url = `${IMG_ROOT}/${encodeURIComponent(filename)}`;
  const outputPath = path.join(outImagesDir, filename);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    return { filename, status: `error:${response.status}` };
  }

  const buf = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buf);
  return { filename, status: "ok", bytes: buf.length };
}

async function runConcurrent(items, worker, concurrency = 6) {
  const queue = [...items];
  const results = [];

  async function runOne() {
    while (queue.length > 0) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runOne));
  return results;
}

async function main() {
  await ensureDirs();

  const models = await fetchJson();
  await fs.writeFile(outDataPath, JSON.stringify(models, null, 2) + "\n", "utf8");

  const uniqueImages = [...new Set(models.map((item) => item.image).filter(Boolean))];
  const downloadResults = await runConcurrent(uniqueImages, downloadImage, 8);

  const okCount = downloadResults.filter((r) => r.status === "ok").length;
  const failed = downloadResults.filter((r) => r.status.startsWith("error"));

  const manifest = {
    source: SOURCE_ROOT,
    fetchedAt: new Date().toISOString(),
    models: models.length,
    uniqueImages: uniqueImages.length,
    downloadedImages: okCount,
    failedImages: failed
  };

  await fs.writeFile(outManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`Models: ${models.length}`);
  console.log(`Unique images: ${uniqueImages.length}`);
  console.log(`Downloaded: ${okCount}`);
  if (failed.length > 0) {
    console.log(`Failed images: ${failed.length}`);
    failed.forEach((item) => console.log(` - ${item.filename}: ${item.status}`));
  }
  console.log(`Saved: ${path.relative(projectRoot, outDataPath)}`);
  console.log(`Saved: ${path.relative(projectRoot, outManifestPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
