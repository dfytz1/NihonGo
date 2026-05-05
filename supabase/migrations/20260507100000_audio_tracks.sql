-- Multiple audio clips per sentence (paths: {sentence_id}/{uuid}.mp3)

alter table public.sentences
  add column if not exists audio_tracks jsonb not null default '[]'::jsonb;

-- One legacy file per row → single entry in audio_tracks
update public.sentences
set audio_tracks = jsonb_build_array(
  jsonb_build_object(
    'path', audio_path,
    'voice_id', coalesce(nullif(trim(coalesce(tts_voice_id, '')), ''), ''),
    'tts_model_id', '',
    'created_at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
)
where coalesce(trim(audio_path), '') <> ''
  and jsonb_array_length(coalesce(audio_tracks, '[]'::jsonb)) = 0;
