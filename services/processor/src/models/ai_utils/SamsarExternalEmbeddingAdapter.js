import {
  createDeployedSamsarClient,
  getDeployedSamsarApiKey,
} from '../api/DeployedSamsarClient.js';
import {
  GALLERY_EMBEDDING_DIMENSIONS,
  GALLERY_EMBEDDING_MODEL,
} from '../gallery/GalleryConstants.js';
import { isStandaloneEdition } from '../../utils/EnvironmentUtils.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function isFalsey(value) {
  return ['0', 'false', 'no', 'off'].includes(normalizeString(value).toLowerCase());
}

export function shouldUseSamsarExternalEmbeddings() {
  if (isFalsey(process.env.SAMSAR_EXTERNAL_EMBEDDINGS_ENABLED)) return false;
  if (!getDeployedSamsarApiKey()) return false;
  if (isTruthy(process.env.SAMSAR_FORCE_EXTERNAL_EMBEDDINGS)) return true;
  if (process.env.OPENAI_API_KEY?.trim()) return false;
  if (isTruthy(process.env.SAMSAR_EXTERNAL_EMBEDDINGS_ENABLED)) return true;
  return isStandaloneEdition();
}

export async function createSamsarExternalEmbeddings(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];
  const client = await createDeployedSamsarClient({ timeoutMs: 240000 });
  const result = await client.postV2('external/embeddings', {
    input: inputs,
    model: GALLERY_EMBEDDING_MODEL,
    dimensions: GALLERY_EMBEDDING_DIMENSIONS,
  });
  const vectors = result?.data?.data;
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
    const error = new Error('The deployed embedding endpoint returned an invalid vector response.');
    error.statusCode = 502;
    throw error;
  }

  return [...vectors]
    .sort((left, right) => Number(left?.index) - Number(right?.index))
    .map((item) => {
      if (!Array.isArray(item?.embedding) || item.embedding.length !== GALLERY_EMBEDDING_DIMENSIONS) {
        const error = new Error('The deployed embedding endpoint returned an invalid vector dimension.');
        error.statusCode = 502;
        throw error;
      }
      return item.embedding;
    });
}
