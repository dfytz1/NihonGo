-- Nihon Go Sentences: initial schema, RLS, storage bucket
-- Run via: supabase db push / SQL editor

-- Sentence processing status:
-- pending | translating | generating_audio | ready | failed_translation | failed_audio | failed_storage

create table if not exists public.sentences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  russian_text text not null,
  japanese_text text not null default '',
  kana text,
  tags text[] not null default '{}',
  audio_path text,
  favorite boolean not null default false,
  status text not null default 'pending',
  translation_model text,
  tts_voice_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sentences_status_check check (
    status in (
      'pending',
      'translating',
      'generating_audio',
      'ready',
      'failed_translation',
      'failed_audio',
      'failed_storage'
    )
  )
);

create index if not exists sentences_user_id_created_at_idx
  on public.sentences (user_id, created_at desc);

create index if not exists sentences_user_id_favorite_idx
  on public.sentences (user_id, favorite);

create index if not exists sentences_user_id_status_idx
  on public.sentences (user_id, status);

create index if not exists sentences_user_id_russian_idx
  on public.sentences (user_id, lower(russian_text));

comment on table public.sentences is 'Personal Japanese sentence bank with RU source, JP translation, optional kana, TTS path';

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sentences_set_updated_at on public.sentences;
create trigger sentences_set_updated_at
  before update on public.sentences
  for each row
  execute procedure public.set_updated_at();

alter table public.sentences enable row level security;

create policy "Users read own sentences"
  on public.sentences for select
  using (auth.uid() = user_id);

create policy "Users insert own sentences"
  on public.sentences for insert
  with check (auth.uid() = user_id);

create policy "Users update own sentences"
  on public.sentences for update
  using (auth.uid() = user_id);

create policy "Users delete own sentences"
  on public.sentences for delete
  using (auth.uid() = user_id);

-- Storage for MP3 files: path = {user_id}/{sentence_id}.mp3
insert into storage.buckets (id, name, public)
values ('sentence-audio', 'sentence-audio', false)
on conflict (id) do nothing;

-- Objects owned by authenticated users under their user_id prefix
create policy "Users read own audio"
  on storage.objects for select
  using (
    bucket_id = 'sentence-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users upload own audio"
  on storage.objects for insert
  with check (
    bucket_id = 'sentence-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own audio"
  on storage.objects for update
  using (
    bucket_id = 'sentence-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own audio"
  on storage.objects for delete
  using (
    bucket_id = 'sentence-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
