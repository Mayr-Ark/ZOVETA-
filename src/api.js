import express from "express";
import { config } from "./config.js";
import * as db from "./db.js";
import { ingestKnowledge, ingestFile, ingestUrl, KB_CATEGORIES } from "./kb.js";
import { logger } from "./logger.js";
import { CREDITS_PER_REPLY, getPlan, PLANS } from "./plans.js";
import { generateReply } from "./reply.js";

const PHONE_RE = /^\d{7,15}$/;
const JID_RE = /^\d{7,15}@s\.whatsapp\.net$/;

function asyncHandler(fn) { return (req, res, next) => fn(req, res, next).catch(next); }
function pagination(query) {
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { offset, limit };
}
async function loadTenant(req, res, next) {
  const tenant = await db.getTenant(req.params.id);
  if (!tenant) return res.status(404).json({ error: "tenant not found" });
  req.tenant = tenant;
  next();
}

export function createApi(sessions) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    if (req.get("x-api-key") !== config.adminApiKey) return res.status(401).json({ error: "unauthorized" });
    next();
  });

  app.get("/tenants", asyncHandler(async (_req, res) => {
    const tenants = await db.listTenants();
    res.json(tenants.map((t) => ({ ...t, session: sessions.status(t.id) })));
  }));

  app.post("/tenants", asyncHandler(async (req, res) => {
    const { name, phone_number, fallback_message, persona, knowledge, owner_id } = req.body ?? {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name is required" });
    if (!PHONE_RE.test(String(phone_number ?? ""))) return res.status(400).json({ error: "phone_number must be digits only in international format, e.g. 2348012345678" });
    const tenant = await db.createTenant({ name, phone_number: String(phone_number), fallback_message, persona, owner_id });
    let kb = null;
    if (typeof knowledge === "string" && knowledge.trim()) {
      try { kb = await ingestKnowledge(tenant.id, knowledge, "business"); }
      catch (err) { await db.deleteTenant(tenant.id).catch((e) => logger.error({ err: e }, "rollback failed")); throw err; }
    }
    const session = await sessions.startTenant(tenant);
    res.status(201).json({ ...tenant, knowledge: kb, session: session.status() });
  }));

  app.get("/tenants/:id", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    res.json({ ...req.tenant, session: sessions.status(req.tenant.id), knowledge: await db.listKbSources(req.tenant.id) });
  }));

  app.patch("/tenants/:id", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const allowed = ["name", "fallback_message", "persona", "status", "business_hours", "out_of_hours_message", "language", "ai_enabled", "reply_guard", "auto_resume_minutes"];
    if (req.body?.auto_resume_minutes !== undefined && (![30, 60, 120, 240, 1440].includes(req.body.auto_resume_minutes)))
      return res.status(400).json({ error: "auto_resume_minutes must be one of 30, 60, 120, 240, 1440" });
    const patch = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)));
    if (patch.status && !["active", "paused"].includes(patch.status)) return res.status(400).json({ error: "status must be 'active' or 'paused'" });
    const tenant = await db.updateTenant(req.tenant.id, patch);
    sessions.updateTenant(tenant);
    res.json({ ...tenant, session: sessions.status(tenant.id) });
  }));

  app.delete("/tenants/:id", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    await sessions.logoutTenant(req.tenant.id);
    await db.deleteTenant(req.tenant.id);
    res.status(204).end();
  }));

  app.get("/tenants/:id/credits", asyncHandler(loadTenant), (req, res) => {
    res.json({ balance: req.tenant.credits, plan: req.tenant.plan, credits_per_reply: CREDITS_PER_REPLY, retention_limit: getPlan(req.tenant.plan).retention_limit });
  });

  app.patch("/tenants/:id/plan", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { plan } = req.body ?? {};
    if (!Object.hasOwn(PLANS, plan)) return res.status(400).json({ error: "plan must be 'free', 'starter', 'basic', or 'pro'" });
    const tenant = await db.setTenantPlan(req.tenant.id, plan);
    sessions.updateTenant(tenant);
    res.json(tenant);
  }));

  app.post("/tenants/:id/credits/topup", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const credits = Number(req.body?.credits);
    if (req.tenant.plan !== "free") return res.status(409).json({ error: "PAYG top-ups are only available on the free plan" });
    if (!Number.isInteger(credits) || credits <= 0 || credits % 50 !== 0) return res.status(400).json({ error: "credits must be a positive multiple of 50" });
    const tenant = await db.topUpCredits(req.tenant.id, credits);
    sessions.updateTenant(tenant);
    res.json({ balance: tenant.credits, plan: tenant.plan, credits_added: credits });
  }));

  app.get("/tenants/:id/contacts", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { offset, limit } = pagination(req.query);
    res.json(await db.listContacts(req.tenant.id, offset, limit));
  }));

  app.put("/tenants/:id/exclusions", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const jids = req.body?.jids;
    if (!Array.isArray(jids) || jids.some((jid) => !JID_RE.test(jid))) return res.status(400).json({ error: "jids must be an array of WhatsApp user JIDs" });
    res.json(await db.replaceExclusions(req.tenant.id, [...new Set(jids)]));
  }));

  app.delete("/tenants/:id/exclusions", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    if (!JID_RE.test(String(req.query.jid ?? ""))) return res.status(400).json({ error: "valid jid query parameter is required" });
    await db.removeExclusion(req.tenant.id, req.query.jid);
    res.status(204).end();
  }));

  app.get("/tenants/:id/conversations", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { offset, limit } = pagination(req.query);
    res.json(await db.listConversations(req.tenant.id, offset, limit));
  }));

  app.get("/tenants/:id/conversations/:chat_id/messages", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { offset, limit } = pagination(req.query);
    res.json(await db.listConversationMessages(req.tenant.id, req.params.chat_id, offset, limit, getPlan(req.tenant.plan).retention_limit));
  }));

  app.get("/tenants/:id/session", asyncHandler(loadTenant), (req, res) => res.json(sessions.status(req.tenant.id)));

  app.get("/tenants/:id/leads", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    res.json(await db.listLeads(req.tenant.id));
  }));
  app.patch("/tenants/:id/leads/:jid", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const stage = String(req.body?.stage ?? "new");
    if (!["new", "contacted", "won", "lost"].includes(stage)) return res.status(400).json({ error: "stage must be new|contacted|won|lost" });
    res.json(await db.setLeadStage(req.tenant.id, req.params.jid, stage));
  }));
  app.post("/tenants/:id/chats/:jid/resume", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    res.json(await db.resumeChat(req.tenant.id, req.params.jid));
  }));
  app.get("/tenants/:id/stats", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    res.json(await db.tenantStats(req.tenant.id));
  }));
  app.get("/tenants/:id/activity", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    res.json(await db.recentActivity(req.tenant.id, Number(req.query.limit ?? 8)));
  }));
  app.post("/tenants/:id/kb/files", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { category, filename, data_b64 } = req.body ?? {};
    if (!data_b64) return res.status(400).json({ error: "data_b64 is required" });
    const result = await ingestFile(req.tenant.id, category ?? "business", filename, Buffer.from(data_b64, "base64"));
    res.json(result);
  }));
  app.post("/tenants/:id/kb/url", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { category, url } = req.body ?? {};
    if (!url) return res.status(400).json({ error: "url is required" });
    res.json(await ingestUrl(req.tenant.id, category ?? "business", url));
  }));
  app.post("/tenants/:id/session/restart", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    await sessions.stopTenant(req.tenant.id);
    const session = await sessions.startTenant(req.tenant);
    res.json(session.status());
  }));
  app.post("/tenants/:id/session/logout", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    await sessions.logoutTenant(req.tenant.id);
    await db.updateTenant(req.tenant.id, { status: "logged_out" });
    res.json(sessions.status(req.tenant.id));
  }));

  app.get("/tenants/:id/knowledge", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    res.json(await db.listKbContents(req.tenant.id));
  }));
  app.put("/tenants/:id/knowledge/:category", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    if (!KB_CATEGORIES.includes(req.params.category)) return res.status(400).json({ error: `category must be one of: ${KB_CATEGORIES.join(", ")}` });
    const { text } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text is required" });
    res.json(await ingestKnowledge(req.tenant.id, text, req.params.category));
  }));
  app.delete("/tenants/:id/knowledge/:category", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    if (!KB_CATEGORIES.includes(req.params.category)) return res.status(400).json({ error: `category must be one of: ${KB_CATEGORIES.join(", ")}` });
    await db.deleteKbChunks(req.tenant.id, req.params.category);
    res.status(204).end();
  }));

  app.post("/tenants/:id/test-reply", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { text, chat_id, customer_name } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text is required" });
    const chatJid = `test:${chat_id || "default"}`;
    const result = await generateReply({ tenant: req.tenant, chatJid, userText: text, customerName: customer_name });
    await result.save();
    res.json({ text: result.text, grounded: result.grounded });
  }));



  app.use((err, _req, res, _next) => {
    logger.error({ err }, "api error");
    res.status(500).json({ error: err.message });
  });
  return app;

  return app;

  // ---------- campaigns: broadcasts & follow-ups ----------
  app.post("/tenants/:id/broadcasts", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { message, audience = "all" } = req.body ?? {};
    if (!message || typeof message !== "string" || message.length < 2) return res.status(400).json({ error: "message is required" });
    if (!["all", "leads"].includes(audience)) return res.status(400).json({ error: "audience must be 'all' or 'leads'" });
    const contacts = await db.listTenantContactsAll(req.tenant.id);
    const targets = audience === "leads" ? contacts.filter((c) => c.is_lead) : contacts;
    if (targets.length === 0) return res.json({ scheduled: 0, note: audience === "leads" ? "No leads yet" : "No contacts yet" });
    const now = Date.now();
    const rows = targets.map((c, i) => ({
      tenant_id: req.tenant.id,
      chat_jid: c.jid,
      content: message.replaceAll("{name}", c.name && !/^\d+$/.test(c.name) ? c.name.split(" ")[0] : "there"),
      kind: "broadcast",
      scheduled_at: new Date(now + (i + 1) * 90_000).toISOString(), // 90s stagger, anti-ban
    }));
    const created = await db.createScheduledSends(rows);
    res.json({ scheduled: created.length, first_at: created[0]?.scheduled_at });
  }));

  app.post("/tenants/:id/followups", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const { message, stale_days = 7 } = req.body ?? {};
    if (!message || typeof message !== "string") return res.status(400).json({ error: "message is required" });
    if (stale_days < 1 || stale_days > 90) return res.status(400).json({ error: "stale_days must be 1-90" });
    const contacts = await db.listTenantContactsAll(req.tenant.id);
    const cutoff = Date.now() - stale_days * 86400e3;
    const stale = [];
    for (const c of contacts.slice(0, 200)) {
      if (c.is_lead === true) continue; // leads get personal follow-up, not a campaign
      const last = await db.lastUserMessageAt(req.tenant.id, c.jid);
      const lastMs = last ? new Date(last).getTime() : 0;
      if (lastMs < cutoff) stale.push(c);
    }
    const now = Date.now();
    // spread over 24h with random gaps, anti-ban
    const perHour = Math.max(1, Math.ceil(stale.length / 24));
    const rows = stale.map((c, i) => ({
      tenant_id: req.tenant.id,
      chat_jid: c.jid,
      content: message.replaceAll("{name}", c.name && !/^\d+$/.test(c.name) ? c.name.split(" ")[0] : "there"),
      kind: "followup",
      scheduled_at: new Date(now + Math.floor(i / perHour) * 3600e3 + Math.floor(Math.random() * 3600e3)).toISOString(),
    }));
    const created = await db.createScheduledSends(rows);
    res.json({ scheduled: created.length, targets: stale.length });
  }));

  app.get("/tenants/:id/scheduled", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    res.json(await db.listScheduledSends(req.tenant.id));
  }));

  app.delete("/tenants/:id/scheduled/:jobId", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const job = await db.cancelScheduledSend(req.tenant.id, req.params.jobId);
    if (!job) return res.status(404).json({ error: "job not found" });
    res.json(job);
  }));

  app.get("/tenants/:id/search", asyncHandler(loadTenant), asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json([]);
    res.json(await db.searchMessages(req.tenant.id, q));
  }));
}
