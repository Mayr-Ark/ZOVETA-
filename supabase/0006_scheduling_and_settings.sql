create table if not exists scheduled_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  chat_jid text not null,
  content text not null,
  kind text not null default 'broadcast' check (kind in ('broadcast','followup')),
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts int not null default 0,
  last_error text,
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_sends_due on scheduled_sends (status, scheduled_at);
alter table tenants add column if not exists ai_enabled boolean not null default true;
alter table tenants add column if not exists reply_guard boolean not null default false;
alter table tenants add column if not exists auto_resume_minutes int not null default 1440;
alter table contact_profiles add column if not exists human_requested boolean not null default false;
