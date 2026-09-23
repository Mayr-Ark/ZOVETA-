-- Run this in the Supabase SQL editor (or `supabase db push`).

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_number text not null unique,               -- international format, digits only
  fallback_message text not null default 'Thanks for reaching out! Someone from our team will get back to you shortly.',
  persona text,                                    -- optional extra instructions (tone, language, business name)
  status text not null default 'active' check (status in ('active', 'paused', 'logged_out')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kb_chunks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  source text not null default 'default',
  chunk_index int not null,
  content text not null,
  embedding vector(384) not null,                  -- all-MiniLM-L6-v2 output size
  version bigint not null default 0,               -- ingest batch id; older versions of a source are dropped after insert
  created_at timestamptz not null default now()
);

create index if not exists kb_chunks_tenant_idx on kb_chunks (tenant_id, source, version);
create index if not exists kb_chunks_embedding_idx
  on kb_chunks using hnsw (embedding vector_cosine_ops);

create table if not exists messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  chat_jid text not null,                          -- WhatsApp JID of the customer chat
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  grounded boolean,                                -- assistant only: true if answered from KB, false if fallback
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_idx on messages (tenant_id, chat_jid, created_at desc);

-- Nearest-neighbour search scoped to a single tenant.
create or replace function match_kb_chunks(
  p_tenant_id uuid,
  p_query_embedding vector(384),
  p_match_count int default 6,
  p_match_threshold float default 0.35
)
returns table (id bigint, content text, source text, similarity float)
language sql stable as $$
  select
    kb_chunks.id,
    kb_chunks.content,
    kb_chunks.source,
    1 - (kb_chunks.embedding <=> p_query_embedding) as similarity
  from kb_chunks
  where kb_chunks.tenant_id = p_tenant_id
    and 1 - (kb_chunks.embedding <=> p_query_embedding) > p_match_threshold
  order by kb_chunks.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- The bot uses the service_role key, so RLS is enabled only to block anon access.
alter table tenants enable row level security;
alter table kb_chunks enable row level security;
alter table messages enable row level security;
