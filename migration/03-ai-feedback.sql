-- AI feedback loop: logs what the AI guessed vs what the user actually saved.
-- Run once in the Supabase SQL Editor.
create table if not exists ai_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  source text not null check (source in ('photo', 'text')),
  input_hint text,
  corrected boolean not null default false,
  ai_result jsonb not null,
  final_result jsonb not null
);
create index if not exists ai_feedback_user_created on ai_feedback (user_id, created_at desc);
