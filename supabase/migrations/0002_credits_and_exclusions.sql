alter table tenants
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'starter', 'basic')),
  add column if not exists credits int not null default 1000;

create table if not exists excluded_contacts (
  tenant_id uuid not null references tenants(id) on delete cascade,
  jid text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, jid)
);

alter table excluded_contacts enable row level security;

alter table kb_chunks
  add column if not exists category text not null default 'business'
    check (category in ('business', 'faq', 'policy', 'products', 'orders'));

create index if not exists kb_chunks_category_idx
  on kb_chunks (tenant_id, category, version);

create index if not exists messages_tenant_chat_idx
  on messages (tenant_id, chat_jid, created_at desc);

create or replace function consume_tenant_credits(
  p_tenant_id uuid,
  p_amount int,
  p_overage_limit int default 0
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  update tenants
  set credits = credits - p_amount,
      updated_at = now()
  where id = p_tenant_id
    and credits - p_amount >= -greatest(p_overage_limit, 0)
  returning credits into v_balance;

  if not found then
    return null;
  end if;
  return v_balance;
end;
$$;
