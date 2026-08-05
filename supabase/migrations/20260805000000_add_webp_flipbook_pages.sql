alter table public.flipbooks
  add column if not exists page_storage_prefix text,
  add column if not exists page_count integer,
  add column if not exists page_width integer,
  add column if not exists page_height integer,
  add column if not exists page_paths jsonb;

alter table public.flipbooks
  alter column storage_path drop not null;

alter table public.flipbooks
  drop constraint if exists flipbooks_storage_path_check;

alter table public.flipbooks
  add constraint flipbooks_storage_path_check
  check (storage_path is null or storage_path ~ '^uploads/[0-9a-f-]{36}\.pdf$');

alter table public.flipbooks
  drop constraint if exists flipbooks_pages_check;

alter table public.flipbooks
  add constraint flipbooks_pages_check
  check (
    (
      storage_path is not null and
      page_storage_prefix is null and
      page_count is null and
      page_width is null and
      page_height is null and
      page_paths is null
    )
    or
    (
      storage_path is null and
      page_storage_prefix ~ '^pages/[0-9a-f-]{36}$' and
      page_count between 1 and 300 and
      page_width > 0 and
      page_height > 0 and
      jsonb_typeof(page_paths) = 'array' and
      jsonb_array_length(page_paths) = page_count
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flipbooks', 'flipbooks', true, 26214400, array['application/pdf', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
