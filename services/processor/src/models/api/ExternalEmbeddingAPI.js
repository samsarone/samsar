import OpenAI from 'openai';

import { deductGenerationCredits } from '../GenerationCredits.js';
import { countTokensForTexts } from '../embeddings/TokenCounter.js';
import {
  GALLERY_EMBEDDING_DIMENSIONS,
  GALLERY_EMBEDDING_MODEL,
} from '../gallery/GalleryConstants.js';

const MAX_EMBEDDING_INPUTS = 100;
const MAX_EMBEDDING_INPUT_CHARS = 12000;
const EMBEDDING_USD_PER_MILLION_TOKENS = 1;
const SAMSAR_CREDITS_PER_USD = 100;

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeInputs(value) {
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.length === 0) {
    throw buildError('input must be a non-empty string or array of strings.');
  }
  if (values.length > MAX_EMBEDDING_INPUTS) {
    throw buildError(`input supports at most ${MAX_EMBEDDING_INPUTS} entries per request.`);
  }

  return values.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw buildError(`input[${index}] must be a non-empty string.`);
    }
    const normalized = entry.trim();
    if (normalized.length > MAX_EMBEDDING_INPUT_CHARS) {
      throw buildError(
        `input[${index}] exceeds the ${MAX_EMBEDDING_INPUT_CHARS}-character limit.`,
        413,
      );
    }
    return normalized;
  });
}

function validateRequestedModel(payload = {}) {
  const requestedModel = typeof payload.model === 'string' ? payload.model.trim() : '';
  if (requestedModel && requestedModel !== GALLERY_EMBEDDING_MODEL) {
    throw buildError(`Only ${GALLERY_EMBEDDING_MODEL} is supported by this endpoint.`);
  }

  const requestedDimensions = Number(payload.dimensions);
  if (
    payload.dimensions !== undefined &&
    (!Number.isInteger(requestedDimensions) || requestedDimensions !== GALLERY_EMBEDDING_DIMENSIONS)
  ) {
    throw buildError(`dimensions must be ${GALLERY_EMBEDDING_DIMENSIONS}.`);
  }
}

function calculateEmbeddingCredits(tokenCount) {
  const costUsd = (Math.max(0, Number(tokenCount) || 0) / 1_000_000) *
    EMBEDDING_USD_PER_MILLION_TOKENS;
  return {
    costUsd,
    credits: costUsd * SAMSAR_CREDITS_PER_USD,
  };
}

export async function createExternalEmbeddingVectors({ userId, payload = {} } = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 401);
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw buildError('The production embedding provider is not configured.', 503);
  }

  validateRequestedModel(payload);
  const inputs = normalizeInputs(payload.input ?? payload.inputs ?? payload.texts);
  const tokenCount = countTokensForTexts(inputs, GALLERY_EMBEDDING_MODEL);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.embeddings.create({
    model: GALLERY_EMBEDDING_MODEL,
    input: inputs,
    dimensions: GALLERY_EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  });
  const billing = calculateEmbeddingCredits(
    response?.usage?.total_tokens ?? response?.usage?.prompt_tokens ?? tokenCount,
  );
  const deduction = billing.credits > 0
    ? await deductGenerationCredits(userId, billing.credits, {
        source: 'external_embedding_create',
        metadata: {
          requestType: 'API',
          category: 'embedding',
          operation: 'create_vectors',
          model: GALLERY_EMBEDDING_MODEL,
          dimensions: GALLERY_EMBEDDING_DIMENSIONS,
          inputCount: inputs.length,
          inputTokens: tokenCount,
          usdPerMillionTokens: EMBEDDING_USD_PER_MILLION_TOKENS,
          costUsd: billing.costUsd,
          creditsCharged: billing.credits,
        },
      })
    : null;

  return {
    response: {
      object: response.object || 'list',
      data: [...response.data].sort((left, right) => left.index - right.index),
      model: response.model || GALLERY_EMBEDDING_MODEL,
      dimensions: GALLERY_EMBEDDING_DIMENSIONS,
      usage: response.usage || {
        prompt_tokens: tokenCount,
        total_tokens: tokenCount,
      },
    },
    creditsCharged: billing.credits,
    remainingCredits: deduction?.remainingCredits ?? null,
  };
}
