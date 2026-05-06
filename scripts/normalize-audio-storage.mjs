#!/usr/bin/env node
/**
 * Rewrites all MP3 objects referenced by `sentences` with EBU R128–style loudnorm
 * (same target as Edge `normalizeMp3ForStorage` / `loudnorm.ts`).
 *
 * Requirements: Node 18+, ffmpeg on PATH (with libmp3lame), npm deps installed at repo root.
 *
 *   export SUPABASE_URL=https://....supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service_role, never commit
 *   npm install   # once, at repo root
 *   npm run normalize-audio
 *
 * Optional: FFMPEG_PATH=/path/to/ffmpeg
 * Optional: DRY_RUN=1 — list paths only, no upload
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import process from "node:process";

const BUCKET = "sentence-audio";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.DRY_RUN === "1";
const ffmpegBin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role from dashboard).",
  );
  process.exit(1);
}

/** @param {Uint8Array} buf */
function normalizeMp3(buf) {
  const r = spawnSync(
    ffmpegBin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-af",
      "loudnorm=I=-16:LRA=11:TP=-1.5:linear=true",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "4",
      "-f",
      "mp3",
      "pipe:1",
    ],
    {
      input: Buffer.from(buf),
      maxBuffer: 80 * 1024 * 1024,
    },
  );
  if (r.error) {
    throw r.error;
  }
  if (r.status !== 0) {
    const err = r.stderr?.toString?.() || "ffmpeg failed";
    throw new Error(err);
  }
  return new Uint8Array(r.stdout);
}

const admin = createClient(url, key);

const { data: rows, error } = await admin
  .from("sentences")
  .select("audio_tracks, audio_path");

if (error) {
  console.error(error.message);
  process.exit(1);
}

/** @type {Set<string>} */
const paths = new Set();
for (const row of rows ?? []) {
  const tracks = row.audio_tracks;
  if (Array.isArray(tracks)) {
    for (const t of tracks) {
      if (t && typeof t.path === "string" && t.path.trim()) {
        paths.add(t.path.trim());
      }
    }
  } else if (row.audio_path && String(row.audio_path).trim()) {
    paths.add(String(row.audio_path).trim());
  }
}

const list = [...paths].sort();
console.log(`Unique audio objects: ${list.length}${dryRun ? " (dry run)" : ""}`);

if (dryRun) {
  for (const p of list) console.log(p);
  process.exit(0);
}

let ok = 0;
let fail = 0;

for (let i = 0; i < list.length; i++) {
  const path = list[i];
  process.stdout.write(`[${i + 1}/${list.length}] ${path} … `);
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(path);
    if (dlErr || !blob) {
      throw new Error(dlErr?.message || "download failed");
    }
    const buf = new Uint8Array(await blob.arrayBuffer());
    const out = normalizeMp3(buf);
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, out, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    console.log("ok");
    ok++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("FAIL", msg);
    fail++;
  }
  await new Promise((r) => setTimeout(r, 50));
}

console.log(JSON.stringify({ ok, fail }, null, 0));
process.exit(fail > 0 ? 1 : 0);
