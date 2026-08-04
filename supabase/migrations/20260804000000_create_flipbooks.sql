create extension if not exists pgcrypto;

create table if not exists public.flipbooks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  slug text not null unique check (slug ~ '^[[:alnum:]][[:alnum:]-]*[[:alnum:]]$' or slug ~ '^[[:alnum:]]$'),
  storage_path text not null unique check (storage_path ~ '^uploads/[0-9a-f-]{36}\.pdf$'),
  file_size bigint not null check (file_size > 0 and file_size <= 26214400),
  created_at timestamptz not null default now()
);

create index if not exists flipbooks_created_at_idx on public.flipbooks (created_at desc);

alter table public.flipbooks enable row level security;
revoke all on table public.flipbooks from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flipbooks', 'flipbooks', true, 26214400, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

