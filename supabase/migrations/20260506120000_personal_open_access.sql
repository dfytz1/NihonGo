-- Personal hobby mode: no Supabase Auth on the client.
-- Anon key (already public in the frontend) can read/write sentences and audio.
-- Edge Functions still require ACCESS_PIN to spend OpenAI / ElevenLabs credits.

alter table public.sentences drop constraint if exists sentences_user_id_fkey;
alter table public.sentences alter column user_id drop not null;

drop policy if exists "Users read own sentences" on public.sentences;
drop policy if exists "Users insert own sentences" on public.sentences;
drop policy if exists "Users update own sentences" on public.sentences;
drop policy if exists "Users delete own sentences" on public.sentences;

drop policy if exists "sentences_anon_select" on public.sentences;
drop policy if exists "sentences_anon_insert" on public.sentences;
drop policy if exists "sentences_anon_update" on public.sentences;
drop policy if exists "sentences_anon_delete" on public.sentences;
drop policy if exists "sentences_auth_select" on public.sentences;
drop policy if exists "sentences_auth_insert" on public.sentences;
drop policy if exists "sentences_auth_update" on public.sentences;
drop policy if exists "sentences_auth_delete" on public.sentences;

create policy "sentences_anon_select" on public.sentences
  for select to anon using (true);
create policy "sentences_anon_insert" on public.sentences
  for insert to anon with check (true);
create policy "sentences_anon_update" on public.sentences
  for update to anon using (true) with check (true);
create policy "sentences_anon_delete" on public.sentences
  for delete to anon using (true);

create policy "sentences_auth_select" on public.sentences
  for select to authenticated using (true);
create policy "sentences_auth_insert" on public.sentences
  for insert to authenticated with check (true);
create policy "sentences_auth_update" on public.sentences
  for update to authenticated using (true) with check (true);
create policy "sentences_auth_delete" on public.sentences
  for delete to authenticated using (true);

update storage.buckets set public = true where id = 'sentence-audio';

drop policy if exists "Users read own audio" on storage.objects;
drop policy if exists "Users upload own audio" on storage.objects;
drop policy if exists "Users update own audio" on storage.objects;
drop policy if exists "Users delete own audio" on storage.objects;

drop policy if exists "audio_anon_select" on storage.objects;
drop policy if exists "audio_anon_insert" on storage.objects;
drop policy if exists "audio_anon_update" on storage.objects;
drop policy if exists "audio_anon_delete" on storage.objects;
drop policy if exists "audio_auth_select" on storage.objects;
drop policy if exists "audio_auth_insert" on storage.objects;
drop policy if exists "audio_auth_update" on storage.objects;
drop policy if exists "audio_auth_delete" on storage.objects;

create policy "audio_anon_select" on storage.objects
  for select to anon using (bucket_id = 'sentence-audio');
create policy "audio_anon_insert" on storage.objects
  for insert to anon with check (bucket_id = 'sentence-audio');
create policy "audio_anon_update" on storage.objects
  for update to anon using (bucket_id = 'sentence-audio');
create policy "audio_anon_delete" on storage.objects
  for delete to anon using (bucket_id = 'sentence-audio');

create policy "audio_auth_select" on storage.objects
  for select to authenticated using (bucket_id = 'sentence-audio');
create policy "audio_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'sentence-audio');
create policy "audio_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'sentence-audio');
create policy "audio_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'sentence-audio');
