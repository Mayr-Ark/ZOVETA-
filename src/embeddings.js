import { env, pipeline } from "@huggingface/transformers";
import { config } from "./config.js";
import { logger } from "./logger.js";

env.cacheDir = "./.cache";

let extractorPromise;

function getExtractor() {
  extractorPromise ??= (async () => {
    logger.info({ model: config.embeddingModel }, "loading embedding model");
    const extractor = await pipeline("feature-extraction", config.embeddingModel, {
      dtype: "fp32",
    });
    logger.info("embedding model ready");
    return extractor;
  })();
  return extractorPromise;
}

export async function embedTexts(texts) {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

export async function embedText(text) {
  const [vector] = await embedTexts([text]);
  return vector;
}
