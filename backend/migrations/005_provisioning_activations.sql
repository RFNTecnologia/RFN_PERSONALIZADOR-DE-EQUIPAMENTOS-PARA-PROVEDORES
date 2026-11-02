create table if not exists provisioning_activations (
  id bigserial primary key,
  device_id varchar(220) not null,
  equipment_id bigint references equipment(id) on delete set null,
  customer_id bigint references customers(id) on delete set null,
  profile_id bigint references equipment_profiles(id) on delete set null,
  profile_name varchar(120) not null default 'RESIDENCIAL',
  manufacturer varchar(80),
  model varchar(120),
  operation_mode varchar(20) not null default 'lab' check (operation_mode in ('lab','customer')),
  pppoe_username varchar(180),
  wifi_ssid_24 varchar(32),
  wifi_ssid_5g varchar(32),
  parameter_count integer not null default 0 check (parameter_count >= 0),
  requested_values jsonb not null default '{}'::jsonb,
  sensitive_paths text[] not null default '{}',
  task_id text,
  task_metadata jsonb not null default '{}'::jsonb,
  status varchar(30) not null default 'submitting',
  status_note text,
  observed_summary jsonb not null default '{}'::jsonb,
  requested_by uuid,
  requested_by_email text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  last_observed_at timestamptz,
  confirmed_at timestamptz
);

create index if not exists provisioning_activations_device_idx
  on provisioning_activations(device_id, id desc);
create index if not exists provisioning_activations_status_idx
  on provisioning_activations(status, updated_at desc);
