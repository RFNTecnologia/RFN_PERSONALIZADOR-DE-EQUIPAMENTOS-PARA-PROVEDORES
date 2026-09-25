create table if not exists customers (
  id bigserial primary key,
  name varchar(180) not null,
  document varchar(40),
  phone varchar(40),
  address text,
  created_at timestamptz not null default now()
);

create table if not exists equipment_profiles (
  id bigserial primary key,
  name varchar(120) unique not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists equipment (
  id bigserial primary key,
  customer_id bigint references customers(id) on delete set null,
  profile_id bigint references equipment_profiles(id) on delete set null,
  acs_device_id varchar(220),
  manufacturer varchar(80) not null,
  model varchar(120) not null,
  equipment_type varchar(40) not null default 'router',
  serial_number varchar(180) not null unique,
  mac varchar(32),
  status varchar(30) not null default 'unknown',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists equipment_mac_idx on equipment(mac);
create unique index if not exists equipment_acs_device_id_idx on equipment(acs_device_id) where acs_device_id is not null;
create index if not exists equipment_customer_idx on equipment(customer_id);

create table if not exists provider_settings (
  id integer primary key,
  company_name varchar(180) not null default 'Sua Empresa',
  logo_url text,
  favicon_url text,
  support_phone varchar(40),
  support_whatsapp varchar(40),
  portal_title varchar(180) not null default 'Configuração do Equipamento',
  portal_message text,
  default_wifi_ssid varchar(120),
  default_wifi_ssid_5g varchar(120),
  acs_url varchar(500),
  acs_username varchar(180),
  connection_request_path varchar(180),
  reset_policy text not null default 'Após reset de fábrica, a recuperação do padrão personalizado depende do suporte do fabricante/firmware.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into provider_settings(id, company_name, portal_title, portal_message)
values(1, 'Sua Empresa', 'Configuração do Equipamento', 'Este equipamento é gerenciado pelo provedor.')
on conflict (id) do nothing;

create table if not exists work_orders (
  id bigserial primary key,
  customer_id bigint references customers(id) on delete set null,
  status varchar(30) not null default 'open',
  title varchar(180),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists evidences (
  id bigserial primary key,
  work_order_id bigint references work_orders(id) on delete cascade,
  kind varchar(20) not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

insert into equipment_profiles(name, description, config)
values
('RESIDENCIAL', 'Perfil residencial inicial', '{"internet":true,"dhcp":true,"nat":true,"port_forward":"blocked","dmz":"blocked","admin":"restricted","wifi":true}'),
('BRIDGE', 'Perfil bridge inicial', '{"mode":"bridge","nat":false,"dhcp":false}'),
('EMPRESA', 'Perfil empresarial inicial', '{"internet":true,"nat":true,"port_forward":"allowed","dmz":"policy","admin":"provider"}')
on conflict (name) do nothing;
