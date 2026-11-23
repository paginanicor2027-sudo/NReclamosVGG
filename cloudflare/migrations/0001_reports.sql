create table reports (
  request_id text primary key not null check (
    length(request_id) = 36
    and substr(request_id, 9, 1) = '-'
    and substr(request_id, 14, 1) = '-'
    and substr(request_id, 19, 1) = '-'
    and substr(request_id, 24, 1) = '-'
    and length(replace(request_id, '-', '')) = 32
    and replace(request_id, '-', '') not glob '*[^0-9a-f]*'
  ),
  tracking_number text not null unique check (
    length(tracking_number) = 20
    and substr(tracking_number, 1, 4) = 'VGG-'
    and substr(tracking_number, 5) not glob '*[^0-9A-F]*'
  ),
  category text not null
    check (category in ('baches', 'luminarias', 'residuos', 'desagues', 'otros')),
  description text not null check (
    length(description) between 1 and 400
    and description = trim(description, ' ' || char(9, 10, 11, 12, 13))
    and instr(description, char(0)) = 0
  ),
  latitude real not null check (latitude between -90 and 90),
  longitude real not null check (longitude between -180 and 180),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'published', 'in_progress', 'resolved', 'rejected')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) strict;

create index reports_public_order_idx on reports (created_at desc, request_id desc)
  where status in ('published', 'in_progress', 'resolved');

create index reports_public_category_order_idx on reports (category, created_at desc, request_id desc)
  where status in ('published', 'in_progress', 'resolved');

create index reports_moderation_order_idx on reports (created_at desc, request_id desc);
create index reports_moderation_status_idx on reports (status, created_at desc, request_id desc);

create trigger enforce_report_status_transition
  before update of status on reports
  for each row
  when new.status <> old.status and not (
    (old.status = 'pending_review' and new.status in ('published', 'rejected'))
    or (
      old.status in ('published', 'in_progress', 'resolved')
      and new.status in ('published', 'in_progress', 'resolved')
    )
  )
begin
  select raise(abort, 'invalid_report_status_transition');
end;
