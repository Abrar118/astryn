// Downloads the docs-search embedding model (BGE-base-en-v1.5, ~440 MB) into
// src-tauri/models/. Run once per checkout: `npm run fetch-model`.
// The files are gitignored and bundled into the app via tauri.conf.json.
//
// The download is pinned to one upstream revision and every file is checked
// against a SHA-256, so the model can't change silently (the stored vectors
// are only valid for these exact weights). To move to a newer revision, update
// REVISION and the hashes together, and bump MODEL_NAME in embedder.rs so
// existing vectors are recomputed.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REPO = "BAAI/bge-base-en-v1.5";
const REVISION = "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a";
const FILES = {
  "config.json": "bc00af31a4a31b74040d73370aa83b62da34c90b75eb77bfa7db039d90abd591",
  "tokenizer.json": "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
  "model.safetensors": "c7c1988aae201f80cf91a5dbbd5866409503b89dcaba877ca6dba7dd0a5167d7",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src-tauri", "models", "bge-base-en-v1.5");

const exists = async (path) => (await stat(path).catch(() => null))?.size > 0;

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

await mkdir(dir, { recursive: true });
for (const [name, expected] of Object.entries(FILES)) {
  const target = join(dir, name);
  if ((await exists(target)) && (await sha256(target)) === expected) {
    console.log(`have ${name}`);
    continue;
  }
  console.log(`fetching ${name} ...`);
  const res = await fetch(`https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`, { redirect: "follow" });
  if (!res.ok || !res.body) {
    console.error(`failed: ${name} (HTTP ${res.status})`);
    process.exit(1);
  }
  // Written under a temp name and only moved into place once the checksum
  // matches, so a partial or tampered download is never mistaken for the model.
  const part = `${target}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  if ((await sha256(part)) !== expected) {
    await rm(part, { force: true });
    console.error(`failed: ${name} does not match its pinned checksum`);
    process.exit(1);
  }
  await rename(part, target);
}
console.log(`model ready in ${dir}`);
