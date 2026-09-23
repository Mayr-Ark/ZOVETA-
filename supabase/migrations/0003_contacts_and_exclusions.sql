-- Contact profiles (WhatsApp pushName), DB-level contact pagination, atomic exclusion replace.

create table if not exists contact_profiles (
  tenant_id uuid not null references tenants(id) on delete cascade,
  jid text not null,
  name text,
  last_message_at timestamptz not null default now(),
  message_count bigint not null default 0,
  primary key (tenant_id, jid)
);

alter table contact_profiles enable row level security;

create index if not exists contact_profiles_recent_idx
  on contact_profiles (tenant_id, last_message_at desc);

-- Called on every incoming customer message; keeps name fresh (never overwrites a
-- known name with null) and message_count monotonic without read-modify-write races.
create or replace function upsert_contact_profile(
  p_tenant_id uuid,
  p_jid text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into contact_profiles (tenant_id, jid, name, last_message_at, message_count)
  values (p_tenant_id, p_jid, p_name, now(), 1)
  on conflict (tenant_id, jid) do update
    set last_message_at = now(),
        message_count = contact_profiles.message_count + 1,
        name = coalesce(excluded.name, contact_profiles.name);
end;
$$;

-- Contacts page / conversations list: paginated in the database, exclusion flag joined.
create or replace function list_tenant_contacts(
  p_tenant_id uuid,
  p_offset int default 0,
  p_limit int default 50
)
returns table (
  jid text,
  name text,
  last_message_at timestamptz,
  message_count bigint,
  excluded boolean
)
language sql
stable
security definer
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
    ) as excluded
  from contact_profiles c
  where c.tenant_id = p_tenant_id
  order by c.last_message_at desc
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 200);
$$;

-- Atomic set-replace: readers never observe an empty set mid-write.
create or replace function replace_exclusions(
  p_tenant_id uuid,
  p_jids text[]
)
returns table (jid text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from excluded_contacts where tenant_id = p_tenant_id;
  insert into excluded_contacts (tenant_id, jid)
  select p_tenant_id, u.j from unnest(p_jids) as u(j)
  on conflict do nothing;
  return query
    select e.jid, e.created_at
    from excluded_contacts e
    where e.tenant_id = p_tenant_id
    order by e.created_at;
end;
$$;
