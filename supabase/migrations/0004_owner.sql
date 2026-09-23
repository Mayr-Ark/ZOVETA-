-- 0004: tie every tenant to the Supabase Auth user who created it.
alter table tenants add column if not exists owner_id uuid;

create index if not exists tenants_owner_id_idx on tenants (owner_id);
