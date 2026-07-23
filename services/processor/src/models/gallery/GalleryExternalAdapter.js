import crypto from 'crypto';

import {
  createDeployedSamsarClient,
  getDeployedSamsarApiKey,
} from '../api/DeployedSamsarClient.js';
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

function extractPresentedApiKey(headers = {}) {
  const authorization = normalizeString(headers.authorization || headers.Authorization);
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return normalizeString(
    bearerMatch?.[1] ||
    headers.api_key ||
    headers.API_KEY ||
    headers['x-api-key'],
  );
}

function secretsMatch(left, right) {
  const leftBuffer = Buffer.from(normalizeString(left));
  const rightBuffer = Buffer.from(normalizeString(right));
  return leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function shouldUseDeployedGallery() {
  if (isFalsey(process.env.SAMSAR_EXTERNAL_GALLERY_ENABLED)) return false;
  if (!getDeployedSamsarApiKey()) return false;
  if (isTruthy(process.env.SAMSAR_FORCE_EXTERNAL_GALLERY)) return true;
  if (isTruthy(process.env.SAMSAR_EXTERNAL_GALLERY_ENABLED)) return true;
  return isStandaloneEdition();
}

export function isConfiguredGalleryServiceRequest(headers = {}) {
  const presentedKey = extractPresentedApiKey(headers);
  const configuredKeys = [
    process.env.SAMSAR_DEPLOYED_API_KEY,
    process.env.SAMSAR_EXTERNAL_API_KEY,
    process.env.SAMSAR_API_KEY,
  ].filter(Boolean);
  return configuredKeys.some((configuredKey) => secretsMatch(presentedKey, configuredKey));
}

async function postDeployedGallery(path, payload = {}) {
  const client = await createDeployedSamsarClient({ timeoutMs: 300000 });
  const response = await client.postV2(`gallery/${path}`, payload);
  return response.data;
}

export function searchDeployedGallery(payload) {
  return postDeployedGallery('search', payload);
}

export function loadDeployedGalleryRecommendations(payload) {
  return postDeployedGallery('recommendations', payload);
}

export function recordDeployedGalleryView(payload) {
  return postDeployedGallery('events/view', payload);
}

export function syncDeployedGallery(payload) {
  return postDeployedGallery('sync', payload);
}

export function updateDeployedGalleryPublicationEmbeddings(payload) {
  return postDeployedGallery('publications/update_embeddings', payload);
}

export function updateDeployedGalleryPublicationClassification(payload) {
  return postDeployedGallery('publications/update_classification', payload);
}

export async function listDeployedGalleryTaxonomy({
  kind,
  limit,
  offset,
  includePublicationIds = false,
}) {
  const client = await createDeployedSamsarClient({ timeoutMs: 300000 });
  const response = await client.getV2(`gallery/taxonomy/${encodeURIComponent(kind)}`, {
    query: {
      limit,
      offset,
      include_publication_ids: includePublicationIds,
    },
  });
  return response.data;
}

export async function getDeployedGalleryTaxonomyPublicationIds({
  kind,
  name,
  limit,
  offset,
}) {
  const client = await createDeployedSamsarClient({ timeoutMs: 300000 });
  const response = await client.getV2(
    `gallery/taxonomy/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/publications`,
    { query: { limit, offset } },
  );
  return response.data;
}

export async function getDeployedGalleryStatus() {
  const client = await createDeployedSamsarClient({ timeoutMs: 300000 });
  const response = await client.getV2('gallery/status');
  return response.data;
}
