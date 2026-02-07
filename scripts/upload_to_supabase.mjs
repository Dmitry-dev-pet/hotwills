import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IMAGE_BUCKET = process.env.IMAGE_BUCKET || "model-images";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourceDataPath = path.join(projectRoot, "data", "source", "data.json");
const sourceImagesDir = path.join(projectRoot, "data", "source", "images");

async function ensureBucket() {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  const exists = (buckets || []).some((bucket) => bucket.name === IMAGE_BUCKET);
  if (exists) return;

  const { error: createError } = await supabase.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: "10MB"
  });

  if (createError) throw createError;
}

async function uploadImageIfExists(imageFile) {
  const diskPath = path.join(sourceImagesDir, imageFile);

  try {
    const content = await fs.readFile(diskPath);
    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(imageFile, content, { upsert: true });

    if (error) throw error;
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

async function upsertModel(model) {
  const payload = {
    name: model.name || "",
    year: model.year || "",
    code: model.code || "",
    image_file: model.image || "",
    source_link: model.link || null,
    created_by: null
  };

  const { error } = await supabase
    .from("models")
    .upsert(payload, { onConflict: "image_file" });

  if (error) throw error;
}

async function main() {
  await ensureBucket();

  const raw = await fs.readFile(sourceDataPath, "utf8");
  const models = JSON.parse(raw);

  if (!Array.isArray(models)) {
    throw new Error("data/source/data.json must be an array");
  }

  let uploaded = 0;
  let missing = 0;

  for (const model of models) {
    if (!model.image) continue;
    const ok = await uploadImageIfExists(model.image);
    if (ok) uploaded += 1;
    else missing += 1;
  }

  for (const model of models) {
    await upsertModel(model);
  }

  console.log(`Imported models: ${models.length}`);
  console.log(`Uploaded images: ${uploaded}`);
  console.log(`Missing local images: ${missing}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
