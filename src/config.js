import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer`);
  return n;
}

function float(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  groqApiKey: required("GROQ_API_KEY"),
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  adminApiKey: required("ADMIN_API_KEY"),
  port: int("PORT", 3000),
  authDir: process.env.AUTH_DIR || "./auth",
  historyLimit: int("HISTORY_LIMIT", 20),
  kbMatchCount: int("KB_MATCH_COUNT", 6),
  kbMatchThreshold: float("KB_MATCH_THRESHOLD", 0.35),
  embeddingModel: process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
  logLevel: process.env.LOG_LEVEL || "info",
};
