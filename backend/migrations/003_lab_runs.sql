create table if not exists lab_runs (
  id bigserial primary key,
  device_id varchar(220) not null,
  manufacturer varchar(80),
  model varchar(120),
  test_type varchar(40) not null,
  parameter_path text,
  requested_value jsonb,
  observed_value jsonb,
  task_result jsonb,
  status varchar(30) not null default 'queued',
  created_at timestamptz not null default now()
);
create index if not exists lab_runs_device_idx on lab_runs(device_id, id desc);
