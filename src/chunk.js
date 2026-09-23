const DEFAULT_MAX_CHARS = 700;
const DEFAULT_OVERLAP = 80;

function splitLong(text, maxChars, overlap) {
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf(" ", end);
      if (breakAt > start + maxChars / 2) end = breakAt;
    }
    pieces.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return pieces.filter(Boolean);
}

/**
 * Split free-form knowledge-base text into retrieval-sized chunks.
 * Paragraphs (blank-line separated) are kept together where possible;
 * consecutive short paragraphs are merged, long ones are split with overlap.
 */
export function chunkText(text, { maxChars = DEFAULT_MAX_CHARS, overlap = DEFAULT_OVERLAP } = {}) {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) chunks.push(current);
      current = "";
      chunks.push(...splitLong(paragraph, maxChars, overlap));
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
