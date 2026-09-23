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

async function ingestRaw(tenantId, text, category, source) {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("Document produced no readable text");
  const rows = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embeddings = await embedTexts(batch);
    batch.forEach((content, j) => {
      rows.push({ tenant_id: tenantId, source, category, chunk_index: i + j, content, embedding: embeddings[j] });
    });
  }
  const version = Date.now();
  await db.deleteKbChunks(tenantId, category, { olderThan: undefined, source });
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    await db.insertKbChunks(rows.slice(i, i + EMBED_BATCH));
  }
  return { chunks: rows.length, source, category };
}

export async function ingestFile(tenantId, category, filename, buffer) {
  if (!KB_CATEGORIES.includes(category)) throw new Error(`Invalid knowledge category: ${category}`);
  const name = String(filename ?? "").toLowerCase();
  let text = "";
  if (name.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    text = (await pdfParse(buffer)).text;
  } else if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) {
    text = buffer.toString("utf8");
  } else {
    throw new Error("Unsupported file type — use PDF, DOCX, TXT, MD or CSV");
  }
  return ingestRaw(tenantId, text, category, filename);
}

export async function ingestUrl(tenantId, category, url) {
  if (!KB_CATEGORIES.includes(category)) throw new Error(`Invalid knowledge category: ${category}`);
  const clean = String(url ?? "").trim();
  if (!/^https?:\/\//.test(clean)) throw new Error("URL must start with http:// or https://");
  const res = await fetch(clean, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return ingestRaw(tenantId, text, category, clean);
}
