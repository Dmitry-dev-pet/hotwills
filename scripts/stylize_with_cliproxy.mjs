import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ENDPOINT = process.env.CLIPROXY_ENDPOINT || "http://127.0.0.1:8317";
const DEFAULT_MODEL = process.env.CLIPROXY_MODEL || "gemini-3-pro-image-preview";
const DEFAULT_PROMPT = [
  "Restyle this toy car photo to match a clean collectible-catalog look.",
  "Keep the same car identity, angle, and proportions.",
  "Use a neutral light background with soft studio shadows.",
  "High detail, crisp edges, realistic die-cast texture, no text, no watermark."
].join(" ");

function usage() {
  return `Usage:
  node scripts/stylize_with_cliproxy.mjs [options]

Required env:
  CLIPROXY_KEY          API key for cliproxyapi

Optional env:
  CLIPROXY_ENDPOINT     default: ${DEFAULT_ENDPOINT}
  CLIPROXY_MODEL        default: ${DEFAULT_MODEL}
  NANO_BANANA_PROMPT    default built-in prompt

Options:
  --pack-dir <path>     input folder with data.json + images/ (default: data/source)
  --out-dir <path>      output folder (default: data/stylized-pack)
  --prompt "<text>"     override prompt
  --prompt-file <path>  read prompt from a file
  --model <id>          override model id
  --endpoint <url>      override endpoint
  --key <value>         override API key (instead of env)
  --limit <n>           process only first N images
  --concurrency <n>     parallel requests (default: 1)
  --no-fallback         do not copy original image when stylization fails
  --force               overwrite already generated files
  --help                show this help
`;
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const plain = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[plain] = true;
      continue;
    }
    flags[plain] = next;
    i += 1;
  }
  return flags;
}

function sanitizeEndpoint(input) {
  const out = String(input || "").trim().replace(/\/+$/, "");
  if (!out) throw new Error("Empty endpoint");
  return out;
}

function getMimeByFileName(fileName) {
  const ext = path.extname(String(fileName || "").toLowerCase());
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function parseDataset(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return { payload: parsed, rows: parsed };
  }
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
    return { payload: parsed, rows: parsed.items };
  }
  throw new Error("data.json must be an array or an object with items[]");
}

function extractImageFieldRows(rows) {
  const list = [];
  for (const row of rows || []) {
    const name = String(row?.image || "").trim();
    if (!name) continue;
    list.push(name);
  }
  return [...new Set(list)];
}

function extractFromDataUri(uri) {
  const match = String(uri || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2].replace(/\s+/g, "");
  return { mime, buffer: Buffer.from(base64, "base64") };
}

function extractFirstUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s)"'<>]+/);
  return m ? m[0] : "";
}

async function resolveImageFromResponsePayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  // Known OpenAI-like image response shapes.
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (item?.b64_json) {
        return { mime: "image/png", buffer: Buffer.from(String(item.b64_json), "base64"), source: "data[].b64_json" };
      }
      if (item?.url && String(item.url).startsWith("data:")) {
        const out = extractFromDataUri(item.url);
        if (out) return { ...out, source: "data[].url(data)" };
      }
      if (item?.url && /^https?:\/\//.test(String(item.url))) {
        const res = await fetch(String(item.url));
        if (res.ok) {
          const mime = res.headers.get("content-type") || "application/octet-stream";
          return { mime, buffer: Buffer.from(await res.arrayBuffer()), source: "data[].url(http)" };
        }
      }
    }
  }

  const content = payload?.choices?.[0]?.message?.content;
  const messageImages = payload?.choices?.[0]?.message?.images;

  if (Array.isArray(messageImages)) {
    for (const img of messageImages) {
      const directUrl =
        img?.image_url?.url ||
        img?.imageUrl?.url ||
        img?.url ||
        (typeof img?.image_url === "string" ? img.image_url : "");
      if (!directUrl) continue;
      if (String(directUrl).startsWith("data:")) {
        const out = extractFromDataUri(directUrl);
        if (out) return { ...out, source: "choices[0].message.images[].image_url(data)" };
      }
      if (/^https?:\/\//.test(String(directUrl))) {
        const res = await fetch(String(directUrl));
        if (res.ok) {
          const mime = res.headers.get("content-type") || "application/octet-stream";
          return { mime, buffer: Buffer.from(await res.arrayBuffer()), source: "choices[0].message.images[].image_url(http)" };
        }
      }
    }
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      const directUrl =
        part?.image_url?.url ||
        part?.imageUrl?.url ||
        part?.url ||
        (typeof part?.image_url === "string" ? part.image_url : "");
      if (directUrl) {
        if (String(directUrl).startsWith("data:")) {
          const out = extractFromDataUri(directUrl);
          if (out) return { ...out, source: "choices[0].message.content[].image_url(data)" };
        }
        if (/^https?:\/\//.test(String(directUrl))) {
          const res = await fetch(String(directUrl));
          if (res.ok) {
            const mime = res.headers.get("content-type") || "application/octet-stream";
            return { mime, buffer: Buffer.from(await res.arrayBuffer()), source: "choices[0].message.content[].image_url(http)" };
          }
        }
      }
      if (typeof part?.text === "string" && part.text.includes("data:image/")) {
        const m = part.text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/);
        if (m) {
          const out = extractFromDataUri(m[0]);
          if (out) return { ...out, source: "choices[0].message.content[].text(data)" };
        }
      }
    }
  }

  if (typeof content === "string") {
    const dataMatch = content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/);
    if (dataMatch) {
      const out = extractFromDataUri(dataMatch[0]);
      if (out) return { ...out, source: "choices[0].message.content(data)" };
    }
    const url = extractFirstUrl(content);
    if (url) {
      const res = await fetch(url);
      if (res.ok) {
        const mime = res.headers.get("content-type") || "application/octet-stream";
        return { mime, buffer: Buffer.from(await res.arrayBuffer()), source: "choices[0].message.content(url)" };
      }
    }
  }

  return null;
}

async function stylizeImageViaCliproxy({ endpoint, key, model, prompt, inputBytes, inputMime }) {
  const dataUri = `data:${inputMime};base64,${inputBytes.toString("base64")}`;
  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUri } }
        ]
      }
    ]
  };

  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    // keep null, handled below
  }

  if (!response.ok) {
    const msg = payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
    throw new Error(`cliproxy error: ${msg}`);
  }

  const extracted = await resolveImageFromResponsePayload(payload);
  if (!extracted || !extracted.buffer || extracted.buffer.length === 0) {
    throw new Error("no image in model response");
  }

  return extracted;
}

async function runQueue(items, worker, concurrency) {
  const q = [...items];
  const out = [];
  const n = Math.max(1, Number(concurrency) || 1);

  async function loop() {
    while (q.length > 0) {
      const item = q.shift();
      out.push(await worker(item));
    }
  }

  await Promise.all(Array.from({ length: Math.min(n, q.length || 1) }, () => loop()));
  return out;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(usage());
    return;
  }

  const key = String(flags.key || process.env.CLIPROXY_KEY || process.env.VITE_PROXY_KEY || "").trim();
  if (!key) {
    throw new Error("Missing CLIPROXY_KEY (or VITE_PROXY_KEY) in environment");
  }

  const endpoint = sanitizeEndpoint(flags.endpoint || DEFAULT_ENDPOINT);
  const model = String(flags.model || DEFAULT_MODEL).trim();
  if (!model) throw new Error("Model is empty");

  const packDir = path.resolve(flags["pack-dir"] || "data/source");
  const inJsonPath = path.join(packDir, "data.json");
  const inImagesDir = path.join(packDir, "images");

  const outDir = path.resolve(flags["out-dir"] || "data/stylized-pack");
  const outJsonPath = path.join(outDir, "data.json");
  const outImagesDir = path.join(outDir, "images");
  const outManifestPath = path.join(outDir, "stylize-manifest.json");

  const promptFile = flags["prompt-file"] ? path.resolve(flags["prompt-file"]) : "";
  let prompt = String(flags.prompt || process.env.NANO_BANANA_PROMPT || "").trim();
  if (!prompt && promptFile) {
    prompt = String(await fs.readFile(promptFile, "utf8")).trim();
  }
  if (!prompt) prompt = DEFAULT_PROMPT;

  const rawData = await fs.readFile(inJsonPath, "utf8");
  const { payload, rows } = parseDataset(rawData);
  const uniqueImagesAll = extractImageFieldRows(rows);
  const limit = flags.limit ? Math.max(1, Number(flags.limit) || 0) : 0;
  const uniqueImages = limit > 0 ? uniqueImagesAll.slice(0, limit) : uniqueImagesAll;
  const concurrency = Math.max(1, Number(flags.concurrency || 1) || 1);
  const useFallback = !flags["no-fallback"];
  const force = Boolean(flags.force);

  await fs.mkdir(outImagesDir, { recursive: true });
  await ensureDir(outJsonPath);

  process.stdout.write(`Model: ${model}\n`);
  process.stdout.write(`Endpoint: ${endpoint}\n`);
  process.stdout.write(`Images to process: ${uniqueImages.length}\n`);
  process.stdout.write(`Concurrency: ${concurrency}\n`);

  const startedAt = new Date().toISOString();
  const manifest = [];

  let done = 0;
  const results = await runQueue(
    uniqueImages,
    async (imageName) => {
      const srcPath = path.join(inImagesDir, imageName);
      const outPath = path.join(outImagesDir, imageName);
      const row = {
        image: imageName,
        status: "pending",
        source: "",
        error: ""
      };

      try {
        if (!force) {
          try {
            await fs.access(outPath);
            row.status = "skipped-existing";
            done += 1;
            process.stdout.write(`[${done}/${uniqueImages.length}] ${imageName} -> skip existing\n`);
            return row;
          } catch {}
        }

        const inputBytes = await fs.readFile(srcPath);
        const inputMime = getMimeByFileName(imageName);
        const styled = await stylizeImageViaCliproxy({
          endpoint,
          key,
          model,
          prompt,
          inputBytes,
          inputMime
        });

        await ensureDir(outPath);
        await fs.writeFile(outPath, styled.buffer);
        row.status = "styled";
        row.source = styled.source;
        done += 1;
        process.stdout.write(`[${done}/${uniqueImages.length}] ${imageName} -> styled (${styled.source})\n`);
        return row;
      } catch (err) {
        row.error = err?.message || String(err);
        if (useFallback) {
          try {
            const sourceBytes = await fs.readFile(srcPath);
            await ensureDir(outPath);
            await fs.writeFile(outPath, sourceBytes);
            row.status = "fallback-original";
            done += 1;
            process.stdout.write(`[${done}/${uniqueImages.length}] ${imageName} -> fallback original (${row.error})\n`);
            return row;
          } catch (fallbackErr) {
            row.status = "failed";
            row.error += ` | fallback failed: ${fallbackErr?.message || String(fallbackErr)}`;
          }
        } else {
          row.status = "failed";
        }
        done += 1;
        process.stdout.write(`[${done}/${uniqueImages.length}] ${imageName} -> failed (${row.error})\n`);
        return row;
      }
    },
    concurrency
  );

  manifest.push(...results);

  await fs.writeFile(outJsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    endpoint,
    model,
    packDir,
    outDir,
    prompt,
    totalInJson: uniqueImagesAll.length,
    processed: uniqueImages.length,
    styled: manifest.filter((x) => x.status === "styled").length,
    fallback: manifest.filter((x) => x.status === "fallback-original").length,
    skipped: manifest.filter((x) => x.status === "skipped-existing").length,
    failed: manifest.filter((x) => x.status === "failed").length,
    items: manifest
  };

  await fs.writeFile(outManifestPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  process.stdout.write(`\nSaved pack:\n`);
  process.stdout.write(` - ${outJsonPath}\n`);
  process.stdout.write(` - ${outImagesDir}\n`);
  process.stdout.write(` - ${outManifestPath}\n`);
  process.stdout.write(`\nStats: styled=${summary.styled}, fallback=${summary.fallback}, skipped=${summary.skipped}, failed=${summary.failed}\n`);

  if (summary.failed > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exitCode = 1;
});
