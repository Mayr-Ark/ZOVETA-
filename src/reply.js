import { config } from "./config.js";
import * as db from "./db.js";
import { embedText } from "./embeddings.js";
import { chatCompletion } from "./llm.js";
import { logger } from "./logger.js";
import { CREDITS_PER_REPLY, getPlan, LIMIT_REPLY, retentionLimit } from "./plans.js";
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
  text = enforceFirstGreeting(text, name, firstReply);

  const save = () => withRetry(
    () => db.saveMessage({ tenant_id: tenant.id, chat_jid: chatJid, role: "assistant", content: text, grounded }),
    log,
  );
  return { text, grounded, save };
}
