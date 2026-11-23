create table public.reports (
  request_id uuid primary key,
  tracking_number text not null unique
    default ('VGG-' || upper(right(replace(gen_random_uuid()::text, '-', ''), 16))),
  category text not null
    check (category in ('baches', 'luminarias', 'residuos', 'desagues', 'otros')),
  description text not null
    check (
      char_length(description) between 1 and 400
      and description !~ '^[[:space:]]|[[:space:]]$'
    ),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  status text not null default 'pending_review' check (status = 'pending_review'),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

revoke all on table public.reports from public, anon, authenticated, service_role;
grant select, insert on table public.reports to service_role;

create function public.submit_report(
  p_request_id uuid,
  p_category text,
  p_description text,
  p_latitude double precision,
  p_longitude double precision
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stored_report public.reports%rowtype;
  created boolean;
begin
  insert into public.reports (
    request_id, category, description, latitude, longitude
  ) values (
    p_request_id, p_category, p_description, p_latitude, p_longitude
  )
  on conflict (request_id) do nothing
  returning * into stored_report;

  created := found;

  if not created then
    select *
    into strict stored_report
    from public.reports
    where request_id = p_request_id;

    if row(
      stored_report.category,
      stored_report.description,
      stored_report.latitude,
      stored_report.longitude
    ) is distinct from row(p_category, p_description, p_latitude, p_longitude) then
      return jsonb_build_object('code', 'request_conflict');
    end if;
  end if;

  return jsonb_build_object(
    'trackingNumber', stored_report.tracking_number,
    'status', 'pending_review',
    'created', created
  );
end;
$$;

revoke all on function public.submit_report(uuid, text, text, double precision, double precision)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_report(uuid, text, text, double precision, double precision)
  to service_role;
