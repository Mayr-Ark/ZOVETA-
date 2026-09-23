-- 0005: handoff pause, lead pipeline, contact memory, business hours, language
alter table contact_profiles add column if not exists paused_until timestamptz;
alter table contact_profiles add column if not exists is_lead boolean not null default false;
alter table contact_profiles add column if not exists lead_stage text not null default 'new';
alter table contact_profiles add column if not exists lead_reason text;
alter table contact_profiles add column if not exists summary text;

alter table tenants add column if not exists business_hours jsonb;
alter table tenants add column if not exists out_of_hours_message text;
alter table tenants add column if not exists language text;

create index if not exists contact_profiles_lead_idx on contact_profiles (tenant_id, is_lead, lead_stage);

-- expose lead + handoff state to the contacts RPC
create or replace function list_tenant_contacts(
  p_tenant_id uuid,
  p_offset integer,
  p_limit integer
)
returns table (
  jid text,
  name text,
  last_message_at timestamptz,
  message_count bigint,
  excluded boolean,
  is_lead boolean,
  lead_stage text,
  paused_until timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    c.jid,
    c.name,
    c.last_message_at,
    c.message_count,
    exists (
      select 1 from excluded_contacts e
      where e.tenant_id = c.tenant_id and e.jid = c.jid
    ) as excluded,
    c.is_lead,
    c.lead_stage,
    c.paused_until
  from contact_profiles c
  where c.tenant_id = p_tenant_id
  order by c.last_message_at desc
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 200);
$$;
