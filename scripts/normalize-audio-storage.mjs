#!/usr/bin/env node
/**
 * Rewrites all MP3 objects referenced by `sentences` with EBU R128 loudnorm.
 * Default: **two-pass** (same logic as Edge `loudnorm.ts`). One pass: SINGLE_PASS_LOUDNORM=1.
 *
 * Targets (optional env, defaults match Edge):
 * - AUDIO_LOUDNORM_I (default -19)
 * - AUDIO_LOUDNORM_TP (default -1.5)
 * - AUDIO_LOUDNORM_LRA (default 11)
 *
 *   export SUPABASE_URL=https://....supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npm install && npm run normalize-audio
 *
 * Optional: FFMPEG_PATH, DRY_RUN=1, SINGLE_PASS_LOUDNORM=1
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import process from "node:process";

const BUCKET = "sentence-audio";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.DRY_RUN === "1";
const ffmpegBin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const singlePass = process.env.SINGLE_PASS_LOUDNORM === "1";

const LOUD_I = process.env.AUDIO_LOUDNORM_I?.trim() || "-19";
const LOUD_TP = process.env.AUDIO_LOUDNORM_TP?.trim() || "-1.5";
const LOUD_LRA = process.env.AUDIO_LOUDNORM_LRA?.trim() || "11";

if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role from dashboard).",
  );
  process.exit(1);
}

function str(v) {
  if (v == null) return "";
  return String(v);
}

function parseLoudnormJson(stderr) {
  const marker = '"input_i"';
  const mi = stderr.indexOf(marker);
  if (mi === -1) throw new Error("loudnorm pass1: no JSON in ffmpeg stderr");
  const start = stderr.lastIndexOf("{", mi);
  if (start === -1) throw new Error("loudnorm pass1: no opening brace");
  let depth = 0;
  let end = -1;
  for (let i = start; i < stderr.length; i++) {
    const c = stderr[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("loudnorm pass1: unclosed JSON");
  return JSON.parse(stderr.slice(start, end + 1));
}

function runFfmpeg(args, inputBuf) {
  const r = spawnSync(ffmpegBin, args, {
    input: Buffer.from(inputBuf),
    maxBuffer: 80 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return {
    status: r.status,
    stdout: r.stdout ? new Uint8Array(r.stdout) : new Uint8Array(0),
    stderr: r.stderr?.toString?.() || "",
  };
}

/** @param {Uint8Array} buf */
function normalizeMp3(buf) {
  if (singlePass) {
    const r = runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-af",
        `loudnorm=I=${LOUD_I}:TP=${LOUD_TP}:LRA=${LOUD_LRA}:linear=true`,
        "-c:a",
        "libmp3lame",
        "-q:a",
        "4",
        "-f",
        "mp3",
        "pipe:1",
      ],
      buf,
    );
    if (r.status !== 0) throw new Error(r.stderr.trim() || "ffmpeg failed");
    if (r.stdout.length === 0) throw new Error("empty output");
    return r.stdout;
  }

  const af1 = `loudnorm=I=${LOUD_I}:TP=${LOUD_TP}:LRA=${LOUD_LRA}:print_format=json`;
  const r1 = runFfmpeg(
    ["-hide_banner", "-i", "pipe:0", "-af", af1, "-f", "null", "-"],
    buf,
  );
  if (r1.status !== 0) throw new Error(`pass1: ${r1.stderr.trim()}`);
  const j = parseLoudnormJson(r1.stderr);
  const measured =
    `measured_I=${str(j.input_i)}:measured_LRA=${str(j.input_lra)}:measured_TP=${str(j.input_tp)}:measured_thresh=${str(j.input_thresh)}:offset=${str(j.target_offset)}:linear=true`;
  const af2 = `loudnorm=I=${LOUD_I}:TP=${LOUD_TP}:LRA=${LOUD_LRA}:${measured}`;
  const r2 = runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-af",
      af2,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "4",
      "-f",
      "mp3",
      "pipe:1",
    ],
    buf,
  );
  if (r2.status !== 0) throw new Error(`pass2: ${r2.stderr.trim()}`);
  if (r2.stdout.length === 0) throw new Error("pass2 empty output");
  return r2.stdout;
}

console.log(
  JSON.stringify({
    target_I: LOUD_I,
    target_TP: LOUD_TP,
    target_LRA: LOUD_LRA,
    passes: singlePass ? 1 : 2,
  }),
);

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
