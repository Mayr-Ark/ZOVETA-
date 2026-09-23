import { chunkText } from "./chunk.js";
import * as db from "./db.js";
import { embedTexts } from "./embeddings.js";
import { logger } from "./logger.js";

const EMBED_BATCH = 32;
export const KB_CATEGORIES = Object.freeze(["business", "faq", "policy", "products", "orders"]);

export async function ingestKnowledge(tenantId, text, category = "business") {
  if (!KB_CATEGORIES.includes(category)) throw new Error(`Invalid knowledge category: ${category}`);
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("Knowledge base text is empty");

  const rows = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embeddings = await embedTexts(batch);
    batch.forEach((content, j) => {
      rows.push({
        tenant_id: tenantId,
        source: category,
        category,
        chunk_index: i + j,
        content,
        embedding: embeddings[j],
      });
    });
  }

  const version = Date.now();
  await db.insertKbChunks(rows.map((r) => ({ ...r, version })));
  await db.deleteKbChunks(tenantId, category, { olderThan: version });
  logger.info({ tenantId, category, chunks: rows.length }, "knowledge base ingested");
  return { category, chunks: rows.length };
}
