# Nihon Sentences — personal Japanese sentence PWA

Private **mobile-first** web app: Russian phrase → natural Japanese + kana + ElevenLabs MP3, stored in **Supabase** (Postgres + Storage + Edge Functions). Translation and TTS keys stay **only** on the server.

## 1. Project structure

```text
NihonGoSentences/
├── frontend/                 # Static PWA (no build step)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── css/styles.css
│   ├── js/
│   │   Config: config.js (template + your values), config.example.js
│   │   Modules: app.js, state.js, utils.js, filters.js, ui.js, player.js
│   └── icons/                # Add PNGs (see icons/README.md)
├── supabase/
│   ├── config.toml           # Function JWT settings
│   ├── migrations/
│   │   ├── 20260505000000_initial_schema.sql
│   │   ├── 20260506120000_personal_open_access.sql
│   │   └── 20260507100000_audio_tracks.sql
│   └── functions/
│       ├── _shared/          # cors, auth, pin, translate (OpenAI), tts (ElevenLabs)
│       ├── verify_pin/
│       ├── usage_snapshot/
│       ├── add_sentence/
│       ├── regenerate_audio/
│       └── batch_regenerate_audio/
├── scripts/
│   └── normalize-audio-storage.mjs   # batch loudnorm for existing MP3s (needs ffmpeg)
└── README.md
```

## 2. SQL schema

Applied by `supabase/migrations/20260505000000_initial_schema.sql`, **`20260506120000_personal_open_access.sql`**, and **`20260507100000_audio_tracks.sql`**.

| Column             | Type        | Notes |
|--------------------|------------|--------|
| `id`               | uuid PK    | |
| `user_id`          | uuid, nullable | Legacy; no Supabase Auth on the client |
| `russian_text`     | text       | |
| `japanese_text`    | text       | |
| `kana`             | text       | optional reading |
| `tags`             | text[]     | |
| `audio_path`       | text       | legacy single path; **`audio_tracks`** holds all clips (`jsonb` array of `{ path, voice_id?, tts_model_id?, created_at }`). New files: `{sentence_id}/{uuid}.mp3` |
| `favorite`         | boolean    | |
| `status`           | text       | `pending` … `ready` / `failed_*` |
| `translation_model`| text       | e.g. OpenAI model id |
| `tts_voice_id`     | text       | ElevenLabs voice |
| `error_message`    | text       | last error |
| `created_at`       | timestamptz| |
| `updated_at`       | timestamptz| trigger |

**RLS (after open-access migration):** the **`anon`** role can select/insert/update/delete all rows in `sentences` and all objects in `sentence-audio`. Anyone with your **anon key** (it is embedded in the static frontend) can read or change data. This is intentional for a small personal app; the **PIN** only gates **Edge Functions** that spend OpenAI / ElevenLabs credits.

The **audio** bucket is set **public** so playback uses simple public URLs.

## 3. Environment variables (Edge Function **secrets**)

Supabase **does not allow** custom secret names that start with `SUPABASE_` — those keys are **injected automatically** in hosted Edge Functions (`SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS`). You do **not** add them manually in the Secrets UI.

Only set **your own** secrets, for example:

| Secret | Required | Purpose |
|--------|----------|---------|
| `ACCESS_PIN` | yes | What you type in the app (min 4 characters); sent as header `X-Access-Pin` |
| `OPENAI_API_KEY` | yes | Translation (natural spoken Japanese) |
| `OPENAI_MODEL` | no | Default `gpt-4o-mini` |
| `ELEVENLABS_API_KEY` | yes | TTS |
| `ELEVENLABS_VOICE_ID` | yes* | Default Japanese-capable voice id |
| `ELEVENLABS_MODEL_ID` | no | Default `eleven_multilingual_v2` |

\*Or set voice only in the app **Settings** tab (local); the function still needs a default if you omit it in the request.

**Never** put `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, or any **secret** API key in `frontend/js` — only **publishable/anon** + project URL in `config.js`.

The shared helper `supabase/functions/_shared/auth.ts` reads the admin client from legacy `SUPABASE_SERVICE_ROLE_KEY` or new `SUPABASE_SECRET_KEYS` JSON, whichever the platform provides.

### PIN (no Supabase login)

1. Set Edge secret **`ACCESS_PIN`** (and translation/TTS keys as above).
2. Deploy **`verify_pin`** with JWT verification off (see `config.toml`).
3. The app sends the PIN as **`access_pin`** in the JSON body to Edge Functions (header `X-Access-Pin` still supported). This avoids fragile CORS preflights on some browsers.

There is **no** `INTERNAL_AUTH_*` or password grant. Rotating `ACCESS_PIN` invalidates unlock until you enter the new PIN.

### Где смотреть логи Edge Functions

В [Supabase Dashboard](https://supabase.com/dashboard) откройте проект → слева **Edge Functions** → выберите, например, **`regenerate_audio`** → вкладка **Logs** (или **Invocations**). Предупреждения вида `normalizeMp3ForStorage: skipped` означают, что на сервере нет **ffmpeg**, и файл сохранён «как из ElevenLabs».

### Audio loudness (normalization)

- **New clips**: TTS uploads use **`synthesizeJapaneseMp3ForStorage`** (`supabase/functions/_shared/tts.ts`), which runs ffmpeg **loudnorm** (`_shared/loudnorm.ts`) so levels match a speech-friendly target (≈ **-16 LUFS**).
- **Hosted Supabase Edge** usually has **no ffmpeg** in PATH. The helper then **falls back to the raw MP3** (warns in logs). For hosted normalization you need a **custom Edge image** with ffmpeg, or normalize locally with the script below.
- **Existing library**: one-time (or repeat) batch — install **ffmpeg** (with **libmp3lame**), then from the **repo root**:

  ```bash
  npm install
  export SUPABASE_URL=https://YOUR_REF.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service_role — never commit or expose
  DRY_RUN=1 npm run normalize-audio          # optional: print paths only
  npm run normalize-audio                    # overwrites objects in `sentence-audio` in place
  ```

- **Opt out**: Edge secret **`DISABLE_AUDIO_LOUDNORM=1`** forces raw ElevenLabs bytes (no loudnorm step).

**Quiet clips after `npm run normalize-audio`:** the PWA Service Worker used to cache **.mp3 cache-first**, so an old file stayed even after Storage was overwritten (same public URL). Current **`sw.js`** uses **network-first for audio** and bumps the audio cache name when needed — reload the app so the new Service Worker installs.

## 4. Setup steps

1. Create a Supabase project.
2. Run migrations (SQL Editor or CLI):

   ```bash
   supabase link --project-ref YOUR_REF
   supabase db push
   ```

3. Install [Supabase CLI](https://supabase.com/docs/guides/cli), then deploy functions:

   ```bash
   cd /path/to/NihonGoSentences
   supabase secrets set ACCESS_PIN=your-pin OPENAI_API_KEY=sk-... ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=...
   supabase functions deploy usage_snapshot
   supabase functions deploy verify_pin
   supabase functions deploy add_sentence
   supabase functions deploy regenerate_audio
   supabase functions deploy batch_regenerate_audio
   ```

4. Copy `frontend/js/config.example.js` to `frontend/js/config.js` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
5. Add PWA icons under `frontend/icons/` (see `frontend/icons/README.md`).
6. Serve `frontend/` over **HTTPS** in production (required for PWA + mic-less audio). Local dev:

   ```bash
   cd frontend && python3 -m http.server 8888
   ```

   Open `http://localhost:8888`.

## 5. Deployment (Vercel)

Deploy **`frontend/`** as a static site. The build step writes `js/config.js` from Vercel environment variables (so you don’t commit keys, though the **anon** key is public by design).

### Connect Vercel to GitHub

1. [Vercel](https://vercel.com) → **Add New… → Project** → import your repo.
2. **Root Directory**: **`frontend`** **or** repo root if you use the root `vercel.json` that `cd`s into `frontend/` (see root `vercel.json`).
3. **Framework Preset**: Vercel may pick “Other”; build is defined in `frontend/package.json`.
4. **Environment Variables** → **Production** (and **Preview** if you use previews):

   | Name | Value |
   |------|--------|
   | `SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
   | `SUPABASE_ANON_KEY` | Publishable/anon key (same as local `config.js`) |

5. **Deploy**. After it finishes, open the `.vercel.app` URL and unlock with your **PIN**.

Auth **URL configuration** in Supabase is optional for this flow (no OAuth or magic links in the app).

### iPhone

Safari → your site → **Share** → **Add to Home Screen**.

### CLI alternative

```bash
cd /path/to/NihonGoSentences/frontend
npx vercel link
npx vercel env add SUPABASE_URL
npx vercel env add SUPABASE_ANON_KEY
npx vercel --prod
```

---

### Other static hosts

Any host that serves the `frontend/` folder over **HTTPS** works the same way: run `npm run build` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set, or upload a generated `js/config.js`.

- **CORS**: Edge Functions use `Access-Control-Allow-Origin: *`. For stricter security, change `supabase/functions/_shared/cors.ts` to your origin only.

## 6. Edge Functions

| Function | Body | Behavior |
|----------|------|----------|
| `verify_pin` | `{}` (PIN in header `X-Access-Pin`) | Returns `{ ok: true }` if PIN matches `ACCESS_PIN` |
| `usage_snapshot` | `{}` | ElevenLabs character/subscription info when the API allows it; OpenAI billing is often unavailable for normal API keys |
| `add_sentence` | `{ russian_text, tags?, voice_id?, openai_model?, elevenlabs_model_id?, skip_duplicate_check? }` | Translate → TTS → **append** clip to `audio_tracks` |
| `regenerate_audio` | `{ sentence_id, voice_id?, elevenlabs_model_id? }` | Adds a **new** MP3 file (unique path) to existing sentence |
| `batch_regenerate_audio` | `{ sentence_ids: string[], voice_id?, elevenlabs_model_id? }` | Up to 8 per call; repeat with `remainder_ids` if returned |

Long batches: call `batch_regenerate_audio` in a loop until `remainder_ids` is empty (queue-friendly pattern for future job table).

## 7. Future improvements

- Supabase **Queues** or **pg_cron** + job table for heavy batch TTS.
- **Alternatives** column or `sentence_variants` table for multiple Japanese versions.
- Stronger **duplicate** matching (normalize unicode, trim, fuzzy).
- **Offline-first** SQLite sync (advanced).
- Per-user **voice presets** in a `profiles` table instead of localStorage.

## Voice picking (ElevenLabs)

Choose a **Japanese** multilingual or native-JP voice in the [ElevenLabs voice library](https://elevenlabs.io/), copy its **Voice ID** into Settings or `ELEVENLABS_VOICE_ID`.

---

MIT — personal use.
