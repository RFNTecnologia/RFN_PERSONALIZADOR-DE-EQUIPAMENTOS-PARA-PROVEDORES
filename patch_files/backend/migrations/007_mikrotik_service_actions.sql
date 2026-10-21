-- RFN V12.6.0: audit trail for RouterOS subscriber access control.
-- Never store PPPoE passwords or RouterOS credentials in this table.
create table if not exists equipment_service_actions (
  id bigserial primary key,
  equipment_id bigint references equipment(id) on delete set null,
  customer_id bigint references customers(id) on delete set null,
  pppoe_username varchar(180) not null,
  action varchar(20) not null check (action in ('block','unblock')),
  result varchar(20) not null check (result in ('success','partial','failed')),
  detail jsonb not null default '{}'::jsonb,
  requested_by uuid,
  requested_by_email varchar(255),
  created_at timestamptz not null default now()
);
create index if not exists equipment_service_actions_equipment_idx
  on equipment_service_actions(equipment_id, created_at desc);
create index if not exists equipment_service_actions_customer_idx
  on equipment_service_actions(customer_id, created_at desc);
