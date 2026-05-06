/**
 * EBU R128–style loudness normalization for MP3 (speech / TTS).
 *
 * Default **two-pass** loudnorm (accurate clip-to-clip matching). Set
 * `AUDIO_LOUDNORM_SINGLE_PASS=1` for one pass (faster, sloppier).
 *
 * Targets (tune with Edge secrets or env):
 * - `AUDIO_LOUDNORM_I` — integrated loudness in LUFS (default **-19**, calmer than -16 on phones)
 * - `AUDIO_LOUDNORM_TP` — true peak in dBTP (default -1.5)
 * - `AUDIO_LOUDNORM_LRA` — loudness range (default 11)
 *
 * Requires ffmpeg + libmp3lame. Hosted Edge usually has no ffmpeg → returns input unchanged.
 * `DISABLE_AUDIO_LOUDNORM=1` skips all processing.
 */

function loudnormTargets() {
  const i = Deno.env.get("AUDIO_LOUDNORM_I")?.trim() || "-19";
  const tp = Deno.env.get("AUDIO_LOUDNORM_TP")?.trim() || "-1.5";
  const lra = Deno.env.get("AUDIO_LOUDNORM_LRA")?.trim() || "11";
  return { i, tp, lra };
}

function parseLoudnormJson(stderr: string): Record<string, unknown> {
  const marker = '"input_i"';
  const mi = stderr.indexOf(marker);
  if (mi === -1) {
    throw new Error("loudnorm pass1: no JSON in ffmpeg stderr");
  }
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
  return JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

async function runFfmpegWithStdin(
  ffmpeg: string,
  args: string[],
  input: Uint8Array,
): Promise<{ stdout: Uint8Array; stderr: string; success: boolean }> {
  const cmd = new Deno.Command(ffmpeg, {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const feedStdin = (async () => {
    const w = child.stdin.getWriter();
    try {
      const CHUNK = 256 * 1024;
      for (let o = 0; o < input.byteLength; o += CHUNK) {
        await w.write(input.subarray(o, Math.min(o + CHUNK, input.byteLength)));
      }
    } finally {
      await w.close();
    }
  })();
  const stdout = new Uint8Array(await child.stdout.arrayBuffer());
  const stderr = await child.stderr.text();
  const status = await child.status;
  await feedStdin;
  return { stdout, stderr, success: status.success };
}

async function normalizeTwoPass(
  ffmpeg: string,
  input: Uint8Array,
  t: { i: string; tp: string; lra: string },
): Promise<Uint8Array> {
  const af1 =
    `loudnorm=I=${t.i}:TP=${t.tp}:LRA=${t.lra}:print_format=json`;
  const r1 = await runFfmpegWithStdin(ffmpeg, [
    "-hide_banner",
    "-i",
    "pipe:0",
    "-af",
    af1,
    "-f",
    "null",
    "-",
  ], input);
  if (!r1.success) {
    throw new Error(`loudnorm pass1 failed: ${r1.stderr.trim()}`);
  }
  const j = parseLoudnormJson(r1.stderr);
  const measured =
    `measured_I=${str(j.input_i)}:measured_LRA=${str(j.input_lra)}:measured_TP=${str(j.input_tp)}:measured_thresh=${str(j.input_thresh)}:offset=${str(j.target_offset)}:linear=true`;
  const af2 = `loudnorm=I=${t.i}:TP=${t.tp}:LRA=${t.lra}:${measured}`;
  const r2 = await runFfmpegWithStdin(ffmpeg, [
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
  ], input);
  if (!r2.success) {
    throw new Error(`loudnorm pass2 failed: ${r2.stderr.trim()}`);
  }
  if (r2.stdout.length === 0) {
    throw new Error("loudnorm pass2: empty output");
  }
  return r2.stdout;
}

async function normalizeSinglePass(
  ffmpeg: string,
  input: Uint8Array,
  t: { i: string; tp: string; lra: string },
): Promise<Uint8Array> {
  const af =
    `loudnorm=I=${t.i}:TP=${t.tp}:LRA=${t.lra}:linear=true:print_format=summary`;
  const r = await runFfmpegWithStdin(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-af",
    af,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "4",
    "-f",
    "mp3",
    "pipe:1",
  ], input);
  if (!r.success) {
    throw new Error(r.stderr.trim());
  }
  if (r.stdout.length === 0) {
    throw new Error("loudnorm: empty output");
  }
  return r.stdout;
}

export async function normalizeMp3ForStorage(
  input: Uint8Array,
): Promise<Uint8Array> {
  if (Deno.env.get("DISABLE_AUDIO_LOUDNORM") === "1") {
    return input;
  }
  const ffmpeg = Deno.env.get("FFMPEG_PATH")?.trim() || "ffmpeg";
  const t = loudnormTargets();
  const single = Deno.env.get("AUDIO_LOUDNORM_SINGLE_PASS") === "1";

  try {
    const out = single
      ? await normalizeSinglePass(ffmpeg, input, t)
      : await normalizeTwoPass(ffmpeg, input, t);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      "normalizeMp3ForStorage: ffmpeg not usable or failed, using original:",
      msg,
    );
    return input;
  }
}
