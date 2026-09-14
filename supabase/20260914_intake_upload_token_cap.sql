create or replace function public.record_intake_file(
  business_id uuid,
  job_id uuid,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes integer,
  intake_upload_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if size_bytes <= 0
    or size_bytes > 10485760
    or lower(mime_type) not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
    or nullif(trim(coalesce(intake_upload_token, '')), '') is null
    or storage_path not like business_id::text || '/' || job_id::text || '/intake/' || intake_upload_token || '/%'
    or (
      select count(*)
      from public.job_files
      where job_files.business_id = record_intake_file.business_id
        and job_files.job_id = record_intake_file.job_id
        and job_files.storage_path like record_intake_file.business_id::text || '/' || record_intake_file.job_id::text || '/intake/' || record_intake_file.intake_upload_token || '/%'
    ) >= 10
    or not exists (
      select 1
      from public.jobs
      where jobs.id = record_intake_file.job_id
        and jobs.business_id = record_intake_file.business_id
        and jobs.source = 'website_form'
        and jobs.intake_upload_token = record_intake_file.intake_upload_token
        and jobs.created_at > now() - interval '30 minutes'
    )
  then
    raise exception 'Invalid intake file';
  end if;

  insert into public.job_files (
    business_id,
    job_id,
    storage_bucket,
    storage_path,
    file_name,
    mime_type,
    size_bytes,
    category,
    source_context
  )
  values (
    business_id,
    job_id,
    'job-files',
    storage_path,
    left(file_name, 120),
    lower(mime_type),
    size_bytes,
    'intake',
    'intake'
  )
  on conflict on constraint job_files_storage_path_key do nothing;
end;
$$;

grant execute on function public.record_intake_file(uuid, uuid, text, text, text, integer, text) to anon, authenticated;
