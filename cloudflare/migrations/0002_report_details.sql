alter table reports add column location_label text
  check (location_label is null or length(location_label) between 1 and 120);

alter table reports add column contact_name text
  check (contact_name is null or length(contact_name) between 1 and 100);

alter table reports add column contact_email text
  check (contact_email is null or length(contact_email) between 1 and 254);

alter table reports add column contact_phone text
  check (contact_phone is null or length(contact_phone) between 1 and 40);

alter table reports add column previously_reported integer not null default 0
  check (previously_reported in (0, 1));

alter table reports add column photo_base64 text
  check (photo_base64 is null or length(photo_base64) between 1 and 245760);
