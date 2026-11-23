alter table public.reports
  drop constraint reports_status_check,
  add constraint reports_status_check
    check (status in ('pending_review', 'published', 'in_progress', 'resolved', 'rejected')),
  add column updated_at timestamptz not null default now();

update public.reports
set updated_at = created_at
where updated_at is distinct from created_at;

create function public.apply_report_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (
    (old.status = 'pending_review' and new.status in ('published', 'rejected'))
    or (
      old.status in ('published', 'in_progress', 'resolved')
      and new.status in ('published', 'in_progress', 'resolved')
    )
  ) then
    raise exception 'Invalid report status transition' using errcode = '23514';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.apply_report_status_change()
  from public, anon, authenticated, service_role;

create trigger set_report_status_updated_at
  before update of status on public.reports
  for each row
  when (old.status is distinct from new.status)
  execute function public.apply_report_status_change();

create table public.report_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.report_moderators enable row level security;
revoke all on table public.report_moderators from public, anon, authenticated, service_role;
grant select on table public.report_moderators to authenticated;

create policy "Users can read their moderator membership"
  on public.report_moderators for select to authenticated
  using (user_id = (select auth.uid()));

grant select, update (status) on table public.reports to authenticated;

create policy "Moderators can read reports"
  on public.reports for select to authenticated
  using (exists (
    select 1
    from public.report_moderators as moderator
    where moderator.user_id = (select auth.uid())
  ));

create policy "Moderators can update report status"
  on public.reports for update to authenticated
  using (exists (
    select 1
    from public.report_moderators as moderator
    where moderator.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.report_moderators as moderator
    where moderator.user_id = (select auth.uid())
  ));

create index reports_public_order_idx on public.reports (created_at desc, request_id desc)
  where status in ('published', 'in_progress', 'resolved');

create function public.list_published_reports(p_category text, p_status text, p_offset integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with page as (
    select report.category, report.description, report.latitude, report.longitude,
           report.status, report.updated_at, report.created_at, report.request_id
    from public.reports as report
    where report.status in ('published', 'in_progress', 'resolved')
      and (p_category is null or report.category = p_category)
      and (p_status is null or report.status = p_status)
    order by report.created_at desc, report.request_id desc
    limit 101 offset greatest(p_offset, 0)
  ),
  numbered as (
    select page.*, row_number() over (order by page.created_at desc, page.request_id desc) as position
    from page
  )
  select jsonb_build_object(
    'reports', coalesce(
      jsonb_agg(jsonb_build_object(
        'category', numbered.category,
        'description', numbered.description,
        'latitude', numbered.latitude,
        'longitude', numbered.longitude,
        'status', numbered.status,
        'updatedAt', numbered.updated_at
      ) order by numbered.position) filter (where numbered.position <= 100),
      '[]'::jsonb
    ),
    'nextOffset', case when count(*) > 100 then greatest(p_offset, 0)::bigint + 100 end
  )
  from numbered;
$$;

create function public.track_report(p_tracking_number text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('status', report.status, 'updatedAt', report.updated_at)
  from public.reports as report
  where report.tracking_number = upper(btrim(p_tracking_number));
$$;

revoke all on function public.list_published_reports(text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.track_report(text)
  from public, anon, authenticated, service_role;

grant execute on function public.list_published_reports(text, text, integer) to service_role;
grant execute on function public.track_report(text) to service_role;
