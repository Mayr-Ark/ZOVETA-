import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { getPlan } from "./plans.js";

export const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function unwrap({ data, error }) {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

export async function listTenants() {
  return unwrap(await supabase.from("tenants").select("*").order("created_at"));
}

export async function getTenant(id) {
  return unwrap(await supabase.from("tenants").select("*").eq("id", id).maybeSingle());
}

export async function createTenant({ name, phone_number, fallback_message, persona, owner_id }) {
  const row = { name, phone_number, persona: persona ?? null };
  if (fallback_message) row.fallback_message = fallback_message;
  if (owner_id) row.owner_id = owner_id;
  return unwrap(await supabase.from("tenants").insert(row).select().single());
}

export async function updateTenant(id, patch) {
  return unwrap(
    await supabase.from("tenants").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single(),
  );
}

export async function setTenantPlan(id, plan) {
  return updateTenant(id, { plan, credits: getPlan(plan).credits });
}

export async function topUpCredits(id, credits) {
  const tenant = await getTenant(id);
  if (!tenant) return null;
  if (tenant.plan !== "free") throw new Error("PAYG top-ups are only available on the free plan");
  return updateTenant(id, { credits: tenant.credits + credits });
}

export async function consumeCredits(tenantId, amount, overageLimit = 0) {
  const balance = unwrap(await supabase.rpc("consume_tenant_credits", {
    p_tenant_id: tenantId,
    p_amount: amount,
    p_overage_limit: overageLimit,
  }));
  return balance === null ? null : Number(balance);
}

export async function deleteTenant(id) {
  unwrap(await supabase.from("tenants").delete().eq("id", id));
}

export async function insertKbChunks(rows) {
  if (rows.length === 0) return;
  unwrap(await supabase.from("kb_chunks").insert(rows));
}

export async function deleteKbChunks(tenantId, category, { olderThan, source } = {}) {
  let q = supabase.from("kb_chunks").delete().eq("tenant_id", tenantId);
  if (category) q = q.eq("category", category);
  if (source) q = q.eq("source", source);
  if (olderThan !== undefined) q = q.lt("version", olderThan);
  unwrap(await q);
}

export async function listKbSources(tenantId) {
  const rows = unwrap(await supabase.from("kb_chunks").select("category").eq("tenant_id", tenantId));
  const counts = new Map();
  for (const { category } of rows) counts.set(category, (counts.get(category) ?? 0) + 1);
  return [...counts].map(([category, chunks]) => ({ category, chunks }));
}

export async function listKbContents(tenantId) {
  const rows = unwrap(
    await supabase.from("kb_chunks").select("category, content, chunk_index").eq("tenant_id", tenantId)
      .order("category").order("chunk_index"),
  );
  const grouped = new Map();
  for (const { category, content } of rows) {
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(content);
  }
  return Object.fromEntries([...grouped].map(([category, chunks]) => [category, chunks.join("\n\n")]));
}

export async function matchKbChunks(tenantId, embedding, { count, threshold }) {
  return unwrap(await supabase.rpc("match_kb_chunks", {
    p_tenant_id: tenantId,
    p_query_embedding: embedding,
    p_match_count: count,
    p_match_threshold: threshold,
  }));
}

export async function saveMessage({ tenant_id, chat_jid, role, content, grounded = null }) {
  unwrap(await supabase.from("messages").insert({ tenant_id, chat_jid, role, content, grounded }));
}

export async function recentMessages(tenantId, chatJid, limit) {
  const rows = unwrap(
    await supabase.from("messages").select("role, content").eq("tenant_id", tenantId).eq("chat_jid", chatJid)
      .order("created_at", { ascending: false }).limit(limit),
  );
  return rows.reverse();
}

export async function isFirstConversationReply(tenantId, chatJid) {
  const rows = unwrap(
    await supabase.from("messages").select("id").eq("tenant_id", tenantId).eq("chat_jid", chatJid)
      .eq("role", "assistant").limit(1),
  );
  return rows.length === 0;
}

export async function upsertContact(tenantId, jid, name) {
  unwrap(await supabase.rpc("upsert_contact_profile", {
    p_tenant_id: tenantId,
    p_jid: jid,
    p_name: name ?? null,
  }));
}

export async function listContacts(tenantId, offset, limit) {
  return unwrap(await supabase.rpc("list_tenant_contacts", {
    p_tenant_id: tenantId,
    p_offset: offset,
    p_limit: limit,
  }));
}

export async function listConversations(tenantId, offset, limit) {
  const rows = await listContacts(tenantId, offset, limit);
  return rows.map((c) => ({
    chat_id: c.jid,
    contact_name: c.name ?? "Customer",
    last_message_at: c.last_message_at,
    message_count: Number(c.message_count),
  }));
}

export async function listConversationMessages(tenantId, chatJid, offset, limit, retention) {
  const effectiveOffset = Math.min(offset, retention);
  if (effectiveOffset >= retention) return [];
  const end = Math.min(effectiveOffset + limit, retention) - 1;
  const rows = unwrap(
    await supabase.from("messages").select("id, role, content, grounded, created_at")
      .eq("tenant_id", tenantId).eq("chat_jid", chatJid).order("created_at", { ascending: false })
      .range(effectiveOffset, end),
  );
  return rows.reverse();
}

export async function listExclusions(tenantId) {
  return unwrap(await supabase.from("excluded_contacts").select("jid, created_at").eq("tenant_id", tenantId));
}

export async function isExcluded(tenantId, jid) {
  const row = unwrap(
    await supabase.from("excluded_contacts").select("jid").eq("tenant_id", tenantId).eq("jid", jid).maybeSingle(),
  );
  return Boolean(row);
}

export async function replaceExclusions(tenantId, jids) {
  return unwrap(await supabase.rpc("replace_exclusions", {
    p_tenant_id: tenantId,
    p_jids: jids,
  }));
}

export async function removeExclusion(tenantId, jid) {
  unwrap(await supabase.from("excluded_contacts").delete().eq("tenant_id", tenantId).eq("jid", jid));
}
export async function pauseChat(tenantId, jid, hours = 24) {
  return unwrap(await supabase.from("contact_profiles").update({ paused_until: new Date(Date.now() + hours * 3600e3).toISOString() }).eq("tenant_id", tenantId).eq("jid", jid));
}
export async function resumeChat(tenantId, jid) {
  return unwrap(await supabase.from("contact_profiles").update({ paused_until: null }).eq("tenant_id", tenantId).eq("jid", jid));
}
export async function isChatPaused(tenantId, jid) {
  const data = unwrap(await supabase.from("contact_profiles").select("paused_until").eq("tenant_id", tenantId).eq("jid", jid).maybeSingle());
  return Boolean(data?.paused_until && new Date(data.paused_until) > new Date());
}
export async function markLead(tenantId, jid, isLead, reason) {
  return unwrap(await supabase.from("contact_profiles").update({ is_lead: isLead, lead_reason: reason ?? null }).eq("tenant_id", tenantId).eq("jid", jid));
}
export async function setLeadStage(tenantId, jid, stage) {
  return unwrap(await supabase.from("contact_profiles").update({ lead_stage: stage }).eq("tenant_id", tenantId).eq("jid", jid));
}
export async function listLeads(tenantId) {
  return unwrap(await supabase.from("contact_profiles").select("jid, name, lead_stage, lead_reason, last_message_at, message_count").eq("tenant_id", tenantId).eq("is_lead", true).order("last_message_at", { ascending: false }).limit(200));
}
export async function tenantStats(tenantId) {
  const rows = unwrap(await supabase.from("messages").select("role, grounded, chat_jid").eq("tenant_id", tenantId).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).limit(5000));
  const bot = rows.filter((m) => m.role === "assistant");
  const total = bot.length || 1;
  return { window_days: 7, total_messages: rows.length, bot_replies: bot.length, active_chats: new Set(rows.map((m) => m.chat_jid)).size, grounded_pct: Math.round(bot.filter((m) => m.grounded).length / total * 100) };
}
export async function recentActivity(tenantId, limit = 8) {
  const rows = unwrap(await supabase.from("messages").select("chat_jid, role, content, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit));
  const jids = [...new Set(rows.map((r) => r.chat_jid))];
  const contacts = jids.length
    ? unwrap(await supabase.from("contact_profiles").select("jid, name, is_lead").eq("tenant_id", tenantId).in("jid", jids))
    : [];
  const byJid = new Map(contacts.map((c) => [c.jid, c]));
  return rows.map((r) => ({
    chat_jid: r.chat_jid,
    name: byJid.get(r.chat_jid)?.name && !/^\d+$/.test(byJid.get(r.chat_jid).name ?? "") ? byJid.get(r.chat_jid).name : "Customer",
    is_lead: Boolean(byJid.get(r.chat_jid)?.is_lead),
    direction: r.role === "user" ? "customer" : r.role === "owner" ? "owner" : "bot",
    preview: r.content,
    at: r.created_at,
  }));
}
