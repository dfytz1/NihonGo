/**
 * Single-pass EBU R128–style loudness normalization for MP3 (speech-friendly).
 * Uses ffmpeg `loudnorm` with linear=true (good enough for TTS clips).
 *
 * Requires `ffmpeg` with libmp3lame on PATH, or set FFMPEG_PATH.
 * On hosted Supabase Edge, ffmpeg is usually absent → this returns the input unchanged (see logs).
 *
 * Set DISABLE_AUDIO_LOUDNORM=1 to skip processing (e.g. debugging).
 */
export async function normalizeMp3ForStorage(
  input: Uint8Array,
): Promise<Uint8Array> {
  if (Deno.env.get("DISABLE_AUDIO_LOUDNORM") === "1") {
    return input;
  }
  const ffmpeg = Deno.env.get("FFMPEG_PATH")?.trim() || "ffmpeg";

  try {
    const cmd = new Deno.Command(ffmpeg, {
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-af",
        "loudnorm=I=-16:LRA=11:TP=-1.5:linear=true:print_format=summary",
        "-c:a",
        "libmp3lame",
        "-q:a",
        "4",
        "-f",
        "mp3",
        "pipe:1",
      ],
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

    const outBuf = new Uint8Array(await child.stdout.arrayBuffer());
    const errText = await child.stderr.text();
    const status = await child.status;
    await feedStdin;

    if (!status.success) {
      console.warn(
        "normalizeMp3ForStorage: ffmpeg failed, using original:",
        errText.trim(),
      );
      return input;
    }
    if (outBuf.length === 0) {
      console.warn(
        "normalizeMp3ForStorage: ffmpeg produced empty output, using original",
      );
      return input;
    }
    return outBuf;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      "normalizeMp3ForStorage: skipped (is ffmpeg installed?):",
      msg,
    );
    return input;
  }
}
