# Zeveto

Multi-tenant WhatsApp auto-reply bot. Each business (tenant) links its own WhatsApp
number and uploads a knowledge base; the bot answers customers **strictly** from that
knowledge base and falls back to a configurable "someone will get back to you"
message when it can't.

Built on free tiers: [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web),
[Groq](https://console.groq.com) (LLM), [Supabase](https://supabase.com) (Postgres + pgvector)
and a local embedding model (no API cost).

## How it works

```
customer msg ──▶ Baileys socket (per tenant)
                    │
                    ▼
      load last 20 messages of this chat (Supabase)
      embed message locally (all-MiniLM-L6-v2)
      top-k similar KB chunks for this tenant (pgvector)
                    │
                    ▼
      Groq chat completion with strict "answer only from context" prompt
                    │
          ┌─────────┴──────────┐
     answer found          "NO_ANSWER"
          │                     │
     send reply       send tenant.fallback_message
```

## Setup

1. **Node 22+** (`nvm use`).
2. **Supabase**: create a project, open the SQL editor and run
   `supabase/migrations/0001_init.sql`.
3. **Groq**: create an API key at https://console.groq.com/keys.
4. Copy `.env.example` to `.env` and fill in the values.
5. `npm install && npm start`

The first run downloads the embedding model (~25 MB) into `.cache/`.

## Onboarding a business

All admin endpoints require the header `x-api-key: $ADMIN_API_KEY`.

```bash
# 1. Create the tenant (optionally with its knowledge base in one go)
curl -X POST localhost:3000/tenants -H "x-api-key: $ADMIN_API_KEY" -H "content-type: application/json" -d '{
  "name": "Acme Bakery",
  "phone_number": "2348012345678",
  "fallback_message": "Thanks for reaching out! A team member will reply shortly.",
  "persona": "Friendly and brief. Address customers as \"boss\" occasionally.",
  "knowledge": "Opening hours: 8am-6pm Mon-Sat.\n\nBread: 500 naira per loaf. Cakes from 5,000 naira, order 24h ahead.\n\nWe deliver within Lagos for 1,000 naira."
}'
# → { id, ..., session: { state: "pairing", pairingCode: "ABCD-EFGH" } }

# 2. On the business's phone: WhatsApp > Linked devices > Link a device >
#    "Link with phone number instead" > enter the pairing code.

# 3. Check it connected
curl localhost:3000/tenants/<id>/session -H "x-api-key: $ADMIN_API_KEY"
# → { state: "connected" }
```

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness (no auth) |
| `GET` | `/tenants` | List tenants with session state |
| `POST` | `/tenants` | Create tenant `{name, phone_number, fallback_message?, persona?, knowledge?}` |
| `GET` | `/tenants/:id` | Tenant, session state, KB sources |
| `PATCH` | `/tenants/:id` | Update `name`, `fallback_message`, `persona`, `status` (`active`/`paused`) |
| `DELETE` | `/tenants/:id` | Unlink WhatsApp and delete tenant + data |
| `GET` | `/tenants/:id/session` | `{state, pairingCode, lastError}` |
| `POST` | `/tenants/:id/session/restart` | Reconnect / issue a new pairing code |
| `POST` | `/tenants/:id/session/logout` | Unlink the WhatsApp device |
| `PUT` | `/tenants/:id/knowledge` | Replace a KB source `{text, source?}` |
| `DELETE` | `/tenants/:id/knowledge?source=` | Delete one source (or all) |
| `POST` | `/tenants/:id/test-reply` | Dry-run the reply pipeline `{text, chat_id?}` without WhatsApp |

Knowledge bases are plain text; blank lines separate topics. Multiple sources per
tenant (e.g. `faq`, `pricing`) can be updated independently.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Any Groq chat model |
| `HISTORY_LIMIT` | `20` | Messages of chat history sent to the model |
| `KB_MATCH_COUNT` | `6` | KB chunks retrieved per message |
| `KB_MATCH_THRESHOLD` | `0.35` | Min cosine similarity for a chunk to count |
| `AUTH_DIR` | `./auth` | Per-tenant WhatsApp credentials (`AUTH_DIR/<tenantId>`) |

## Notes / limits

- Group chats, broadcasts and newsletters are ignored; only 1:1 text (and media captions) get replies.
- WhatsApp credentials live on disk, so run a single instance per `AUTH_DIR`. Scaling
  to thousands of tenants means sharding tenants across instances (and moving auth
  state into Supabase) — the rest of the pipeline is already stateless.
- Groq free tier has per-minute limits; the SDK retries 429s automatically.

## Development

```bash
npm test      # unit tests (chunking, prompt building)
npm run lint  # syntax check
npm run dev   # start with file watching
```
