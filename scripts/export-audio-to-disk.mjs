#!/usr/bin/env node
/**
 * Download every MP3 referenced by `sentences` into one folder (flat layout).
 *
 *   export SUPABASE_URL=https://....supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...   # service_role or anon if your RLS allows
 *   npm run export-audio
 *
 * Optional: EXPORT_DIR=~/Music/NihonGo-audio
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BUCKET = "sentence-audio";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const outRoot = path.resolve(
  process.env.EXPORT_DIR?.trim() || path.join(process.cwd(), "exported-audio"),
);

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see scripts/normalize-audio-storage.mjs).",
  );
  process.exit(1);
}

/** @param {string} s @param {number} max */
function safeFilePart(s, max) {
  const t = (s || "")
    .replace(/["*/:<>?\\|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return t || "sentence";
}

const admin = createClient(url, key);

const { data: rows, error } = await admin
  .from("sentences")
  .select("id, russian_text, audio_tracks, audio_path, created_at")
  .order("created_at", { ascending: true });

if (error) {
  console.error(error.message);
  process.exit(1);
}

/** @type {{ path: string; id: string; ru: string }[]} */
const items = [];
for (const row of rows ?? []) {
  const tracks = Array.isArray(row.audio_tracks) ? row.audio_tracks : [];
  const paths = [];
  for (const t of tracks) {
    if (t && typeof t.path === "string" && t.path.trim()) {
      paths.push(t.path.trim());
    }
  }
  if (!paths.length && row.audio_path && String(row.audio_path).trim()) {
    paths.push(String(row.audio_path).trim());
  }
  const sid = String(row.id);
  const ru = String(row.russian_text ?? "");
  for (const p of paths) {
    items.push({ path: p, id: sid, ru });
  }
}

/** @type {Map<string, { path: string; id: string; ru: string }>} */
const byPath = new Map();
for (const it of items) {
  if (!byPath.has(it.path)) byPath.set(it.path, it);
}

const list = [...byPath.values()];
console.log(`Tracks to download: ${list.length} → ${outRoot}`);

await fs.mkdir(outRoot, { recursive: true });

let ok = 0;
let fail = 0;
let n = 0;

for (const { path: storagePath, id: sentenceId, ru } of list) {
  n++;
  const m = storagePath.match(/([a-f0-9-]{36})\.mp3$/i);
  const clipId = m ? m[1].slice(0, 8) : String(n).padStart(4, "0");
  const fname = `${String(n).padStart(3, "0")}_${safeFilePart(ru, 60)}__${clipId}.mp3`;
  const dest = path.join(outRoot, fname);

  process.stdout.write(`[${n}/${list.length}] ${fname} … `);
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(storagePath);
    if (dlErr || !blob) {
      throw new Error(dlErr?.message || "download failed");
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(dest, buf);
    console.log(`${buf.length} bytes`);
    ok++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("FAIL", msg);
    fail++;
  }
}

console.log(JSON.stringify({ dir: outRoot, ok, fail }, null, 0));
process.exit(fail > 0 ? 1 : 0);
