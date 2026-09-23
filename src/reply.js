import { config } from "./config.js";
import * as db from "./db.js";
import { embedText } from "./embeddings.js";
import { chatCompletion } from "./llm.js";
import { logger } from "./logger.js";
import { CREDITS_PER_REPLY, getPlan, LIMIT_REPLY, retentionLimit } from "./plans.js";
import { markLead } from "./db.js";
import { buildMessages, isNoAnswer } from "./prompt.js";

const SAVE_RETRIES = 5;
const SAVE_RETRY_BASE_MS = 500;
const GREETING_RE = /^(hi|hello|hey|good morning|good afternoon|good evening|welcome|greetings|dear)\b/i;
const PAYMENT_RE = /\b(pay|payment|transfer|bank account|card|checkout|send money|deposit|paid)\b/i;

async function withRetry(fn, log) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt >= SAVE_RETRIES) throw err;
      log.warn({ err, attempt }, "saving assistant message failed, retrying");
      await new Promise((r) => setTimeout(r, SAVE_RETRY_BASE_MS * 2 ** (attempt - 1)));
    }
  }
}

function firstName(value) {
  const cleaned = String(value ?? "").trim().replace(/^[@+]/, "");
  if (!cleaned || /^\d+$/.test(cleaned)) return null;
  return cleaned.split(/\s+/)[0];
}

function warmGreeting(name) {
  return name ? `Hello ${name}!` : "Hello!";
}

function enforceFirstGreeting(text, name, firstReply) {
  if (!firstReply || GREETING_RE.test(text.trim())) return text.trim();
  return `${warmGreeting(name)} ${text.trim()}`.trim();
}

export async function generateReply({ tenant, chatJid, userText, customerName }) {
  const log = logger.child({ tenantId: tenant.id, chatJid });
  const name = firstName(customerName);
  const limit = retentionLimit(tenant.plan);
  const [history, firstReply] = await Promise.all([
    db.recentMessages(tenant.id, chatJid, limit),
    db.isFirstConversationReply(tenant.id, chatJid),
  ]);
  await db.saveMessage({ tenant_id: tenant.id, chat_jid: chatJid, role: "user", content: userText });

  const plan = getPlan(tenant.plan);
  const balance = await db.consumeCredits(tenant.id, CREDITS_PER_REPLY, plan.overage_credits);
  if (balance === null) {
    const text = enforceFirstGreeting(LIMIT_REPLY, name, firstReply);
    return {
      text,
      grounded: false,
      save: () => withRetry(() => db.saveMessage({ tenant_id: tenant.id, chat_jid: chatJid, role: "assistant", content: text, grounded: false }), log),
    };
  }
  tenant.credits = balance;

  // business hours: outside them (when configured), reply with the out-of-hours message
  const bh = tenant.business_hours;
  if (bh?.open != null && bh?.close != null) {
    const lagos = new Date(Date.now() + 3600e3); // Africa/Lagos = UTC+1
    const hour = lagos.getUTCHours() + lagos.getUTCMinutes() / 60;
    const open = Number(bh.open), close = Number(bh.close);
    const inHours = open <= close ? hour >= open && hour < close : hour >= open || hour < close;
    if (!inHours) {
      const text = enforceFirstGreeting(tenant.out_of_hours_message || tenant.fallback_message, name, firstReply);
      return { text, grounded: false, save: () => withRetry(() => db.saveMessage({ tenant_id: tenant.id, chat_jid: chatJid, role: "assistant", content: text, grounded: false }), log) };
    }
  }

  let chunks = [];
  let text;
  let grounded = false;
  try {
    const queryEmbedding = await embedText(userText);
    chunks = await db.matchKbChunks(tenant.id, queryEmbedding, {
      count: config.kbMatchCount,
      threshold: config.kbMatchThreshold,
    });
    log.debug({ matches: chunks.length }, "kb retrieval done");
    const userMsgs = history.filter((m) => m.role === "user").slice(-3).map((m) => m.content.slice(0, 120));
    if (userMsgs.length) tenant.memory = `Recently asked: ${userMsgs.join(" | ")}`;
    const raw = await chatCompletion(buildMessages({ tenant, chunks, history, userText, customerName: name, firstReply }));
    if (isNoAnswer(raw)) {
      text = tenant.fallback_message;
    } else {
      text = raw.trim();
      grounded = true;
    }
  } catch (err) {
    log.error({ err }, "reply generation failed, using fallback");
    text = tenant.fallback_message;
  }

  if (PAYMENT_RE.test(userText) && chunks.length === 0) {
    text = tenant.fallback_message;
    grounded = false;
  }

  // lead detection: model appends LEAD:yes/no on its own line — strip it and record
  let leadFlag = null;
  const leadMatch = text.match(/\n?LEAD:\s*(yes|no)\s*(?:[-–—]\s*(.*))?\s*$/i);
  if (leadMatch) {
    leadFlag = leadMatch[1].toLowerCase() === "yes";
    const reason = (leadMatch[2] ?? "").trim() || null;
    text = text.replace(/\n?LEAD:\s*(yes|no)\s*(?:[-–—]\s*(.*))?\s*$/i, "").trim();
    markLead(tenant.id, chatJid, leadFlag, reason).catch(() => {});
  }
  text = enforceFirstGreeting(text, name, firstReply);

  const save = () => withRetry(
    () => db.saveMessage({ tenant_id: tenant.id, chat_jid: chatJid, role: "assistant", content: text, grounded }),
    log,
  );
  return { text, grounded, save };
}

// contact memory: rolling summary of what the customer asked about (no extra LLM call)
export async function contactMemory(tenantId, chatJid) {
  const rows = await db.recentMessages(tenantId, chatJid, 12);
  const userMsgs = rows.filter((m) => m.role === "user").slice(-3).map((m) => m.content.slice(0, 120));
  return userMsgs.length ? `Recently asked: ${userMsgs.join(" | ")}` : "";
}
