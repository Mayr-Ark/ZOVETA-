import * as db from "./db.js";
import * as sessions from "./sessions.js";
import { logger } from "./logger.js";

const TICK_MS = 60_000;
const MAX_PER_TICK = 5;
const HOURLY_CAP = 20;
const MAX_ATTEMPTS = 3;

let timer = null;

export function start() {
  if (timer) return;
  timer = setInterval(() => tick().catch((err) => logger.error({ err }, "scheduler tick failed")), TICK_MS);
  logger.info("scheduler started");
}

export function stop() { if (timer) clearInterval(timer); timer = null; }

async function tick() {
  const due = await db.dueScheduledSends(MAX_PER_TICK);
  if (due.length === 0) return;
  for (const job of due) {
    try {
      const recent = await db.sendsLastHour(job.tenant_id);
      if (recent >= HOURLY_CAP) {
        logger.info({ tenantId: job.tenant_id }, "hourly send cap reached — retrying later");
        continue; // stays pending, picked up next tick
      }
      const session = sessions.get(job.tenant_id);
      if (!session || session.state !== "connected") continue; // session not ready; retry later
      await session.sendOutbound(job.chat_jid, job.content);
      await db.markScheduledSend(job.id, "sent");
      logger.info({ tenantId: job.tenant_id, chatJid: job.chat_jid, kind: job.kind }, "scheduled send delivered");
    } catch (err) {
      const attempts = job.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await db.markScheduledSend(job.id, failed ? "failed" : "pending", err.message, attempts);
      logger.warn({ err, jobId: job.id, failed }, "scheduled send attempt failed");
    }
  }
}
