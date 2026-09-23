import { rm } from "node:fs/promises";
import path from "node:path";
import baileys, { DisconnectReason, fetchLatestBaileysVersion, isJidBroadcast, isJidGroup, isJidNewsletter, jidNormalizedUser, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createChannelAdapter } from "./channel.js";
import { config } from "./config.js";
import * as db from "./db.js";
import { logger } from "./logger.js";
import { generateReply } from "./reply.js";

const makeWASocket = baileys.default ?? baileys;
const RECONNECT_DELAY_MS = 3000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class TenantSession {
  constructor(tenant) {
    this.tenant = tenant;
    this.sock = null;
    this.state = "starting";
    this.pairingCode = null;
    this.lastError = null;
    this.stopped = false;
    this.chatQueues = new Map();
    this.log = logger.child({ tenantId: tenant.id, tenant: tenant.name });
  }

  get authDir() {
    const id = String(this.tenant.id);
    if (!UUID_RE.test(id)) throw new Error(`Invalid tenant id: ${id}`);
    const root = path.resolve(config.authDir);
    const dir = path.resolve(root, id);
    if (path.dirname(dir) !== root) throw new Error(`Auth dir escapes root: ${id}`);
    return dir;
  }

  status() { return { tenantId: this.tenant.id, state: this.state, pairingCode: this.pairingCode, lastError: this.lastError }; }

  async start() {
    this.stopped = false;
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();
    if (this.stopped) return;
    const sock = makeWASocket({ auth: state, version, printQRInTerminal: false, logger: this.log.child({ module: "baileys" }, { level: "silent" }), browser: ["Zeveto", "Chrome", "1.0.0"], syncFullHistory: false, markOnlineOnConnect: false });
    this.sock = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => this.onConnectionUpdate(update));
    sock.ev.on("messages.upsert", (upsert) => this.onMessages(upsert));
    if (!state.creds.registered) {
      this.state = "pairing";
      try { this.pairingCode = await sock.requestPairingCode(this.tenant.phone_number, String(Math.floor(10000000 + Math.random() * 90000000))); this.log.info("pairing code issued (fetch it via GET /tenants/:id/session)"); }
      catch (err) { this.lastError = err.message; this.log.error({ err }, "failed to request pairing code"); }
    }
  }

  async stop() { this.stopped = true; this.state = "stopped"; this.sock?.end(undefined); this.sock = null; }
  async logout() {
    this.stopped = true;
    try { await this.sock?.logout(); } catch (err) { this.log.warn({ err }, "logout failed, clearing local credentials anyway"); }
    this.sock = null; this.state = "logged_out"; this.pairingCode = null;
    await rm(this.authDir, { recursive: true, force: true });
  }

  onConnectionUpdate({ connection, lastDisconnect }) {
    if (connection === "open") {
      this.state = "connected"; this.pairingCode = null; this.lastError = null; this.log.info("connected to WhatsApp");
      if (this.tenant.status === "logged_out") {
        db.updateTenant(this.tenant.id, { status: "active" }).catch((err) => this.log.error({ err }, "failed to mark tenant active"));
        this.tenant.status = "active";
      }
      return;
    }
    if (connection !== "close" || this.stopped) return;
    const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
    this.lastError = lastDisconnect?.error?.message ?? null;
    if (statusCode === DisconnectReason.loggedOut) {
      this.log.warn("device logged out; credentials removed, re-pairing required"); this.state = "logged_out";
      rm(this.authDir, { recursive: true, force: true }).then(() => db.updateTenant(this.tenant.id, { status: "logged_out" })).then(() => this.restart()).catch((err) => this.log.error({ err }, "failed to reset after logout"));
      return;
    }
    this.state = "disconnected"; this.log.warn({ statusCode }, "connection closed, reconnecting"); this.restart();
  }

  restart() { setTimeout(() => { if (this.stopped) return; this.start().catch((err) => { this.lastError = err.message; this.log.error({ err }, "restart failed, retrying"); this.restart(); }); }, RECONNECT_DELAY_MS); }

  onMessages({ type, messages }) {
    if (type !== "notify") return;
    for (const msg of messages) {
      const text = extractText(msg);
      const from = msg.key?.remoteJid;
      if (!text || !from) continue;
      if (msg.key.fromMe) {
        if (isJidGroup(from) || isJidBroadcast(from) || isJidNewsletter(from)) continue;
        const ownerJid = jidNormalizedUser(from);
        db.saveMessage({ tenant_id: this.tenant.id, chat_jid: ownerJid, role: "owner", content: text }).catch(() => {});
        db.pauseChat(this.tenant.id, ownerJid, 24)
          .then(() => this.log.info({ chatJid: ownerJid }, "owner replied from phone — AI paused 24h for this chat"))
          .catch((err) => this.log.warn({ err }, "failed to pause chat after owner reply"));
        continue;
      }
      if (isJidGroup(from) || isJidBroadcast(from) || isJidNewsletter(from)) continue;
      const chatJid = jidNormalizedUser(from);
      const customerName = msg.pushName || null;
      this.enqueue(chatJid, () => this.handleIncoming({ channel: this.whatsAppAdapter(), channelChatId: from, chatJid, text, customerName }));
    }
  }

  whatsAppAdapter() {
    return createChannelAdapter({
      sendText: async (chatId, text) => {
        const jitter = 800 + Math.floor(Math.random() * 1700); // 0.8s–2.5s human-like pause
        await new Promise((r) => setTimeout(r, jitter));
        return this.sock.sendMessage(chatId, { text });
      },
      setComposing: (chatId) => this.sock.sendPresenceUpdate("composing", chatId).catch(() => {}),
    });
  }

  enqueue(chatJid, task) {
    const previous = this.chatQueues.get(chatJid) ?? Promise.resolve();
    const next = previous.then(task).catch((err) => this.log.error({ err, chatJid }, "message handling failed"));
    this.chatQueues.set(chatJid, next);
    next.finally(() => { if (this.chatQueues.get(chatJid) === next) this.chatQueues.delete(chatJid); });
  }

  async handleIncoming({ channel, channelChatId, chatJid, text, customerName }) {
    if (this.tenant.status !== "active" || await db.isExcluded(this.tenant.id, chatJid)) return;
    if (await db.isChatPaused(this.tenant.id, chatJid)) return this.log.info({ chatJid }, "chat paused (human handoff) — AI stays silent");
    this.log.info({ chatJid, text }, "incoming message");
    db.upsertContact(this.tenant.id, chatJid, customerName)
      .catch((err) => this.log.warn({ err, chatJid }, "failed to save contact profile"));
    await channel.setComposing(channelChatId);
    const result = await generateReply({ tenant: this.tenant, chatJid, userText: text, customerName });
    await channel.sendText(channelChatId, result.text);
    await result.save();
    this.log.info({ chatJid, grounded: result.grounded }, "reply sent");
  }
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  const inner = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m;
  return inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption || null;
}

export class SessionManager {
  constructor() { this.sessions = new Map(); }
  async startAll() { const tenants = await db.listTenants(); logger.info({ count: tenants.length }, "starting tenant sessions"); await Promise.allSettled(tenants.map((t) => this.startTenant(t))); }
  async startTenant(tenant) {
    const existing = this.sessions.get(tenant.id);
    if (existing) { existing.tenant = tenant; return existing; }
    const session = new TenantSession(tenant); this.sessions.set(tenant.id, session);
    try { await session.start(); } catch (err) { session.lastError = err.message; session.state = "disconnected"; session.log.error({ err }, "failed to start session"); session.restart(); }
    return session;
  }
  updateTenant(tenant) { const session = this.sessions.get(tenant.id); if (session) session.tenant = tenant; }
  async stopTenant(tenantId) { const session = this.sessions.get(tenantId); if (!session) return; await session.stop(); this.sessions.delete(tenantId); }
  async logoutTenant(tenantId) { const session = this.sessions.get(tenantId); if (!session) return; await session.logout(); this.sessions.delete(tenantId); }
  status(tenantId) { return this.sessions.get(tenantId)?.status() ?? { tenantId, state: "not_running" }; }
  async stopAll() { await Promise.all([...this.sessions.keys()].map((id) => this.stopTenant(id))); }
}
