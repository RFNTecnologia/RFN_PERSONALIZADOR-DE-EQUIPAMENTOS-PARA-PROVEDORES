alter table equipment add column if not exists service_status varchar(30) not null default 'enabled';
create index if not exists equipment_service_status_idx on equipment(service_status);
