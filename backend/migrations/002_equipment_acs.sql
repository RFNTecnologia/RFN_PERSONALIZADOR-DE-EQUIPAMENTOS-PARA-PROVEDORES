alter table equipment add column if not exists acs_device_id varchar(220);
create unique index if not exists equipment_acs_device_id_idx on equipment(acs_device_id) where acs_device_id is not null;
