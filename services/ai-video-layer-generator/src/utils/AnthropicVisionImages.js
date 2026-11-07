import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ENCODED_IMAGE_BYTES = 10_000_000;
const LOCAL_MEDIA_ALIASES = ['generations', 'temp_images', 'user_resources', 'video', 'ai_video'];
const OWNED_MEDIA_ENV_KEYS = [
  'SAMSAR_PROVIDER_MEDIA_BASE_URL', 'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL', 'MEDIA_PUBLIC_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL', 'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_MEDIA_TUNNEL_PUBLIC_URL', 'SAMSAR_INTERNAL_MEDIA_BASE_URL',
];

const normalized = value => String(value || '').trim().toLowerCase();
const enabled = value => ['1', 'true', 'yes', 'on'].includes(normalized(value));

export function usesLocalAnthropicVisionImages(env = process.env) {
  const edition = normalized(env.SAMSAR_DEPLOYMENT_EDITION || env.SAMSAR_EDITION || env.CURRENT_ENV);
  if (!['docker', 'community', 'standalone'].includes(edition)) return false;
  const runtime = normalized(env.SAMSAR_RUNTIME || env.SAMSAR_DEPLOYMENT_RUNTIME);
  const docker = runtime ? runtime === 'docker' : ['docker', 'standalone', 'staging'].includes(normalized(env.CURRENT_ENV));
  if (!docker) return false;
  const mode = normalized(env.SAMSAR_MEDIA_DELIVERY_MODE || env.MEDIA_DELIVERY_MODE);
  if (['s3-cloudfront', 'external-s3'].includes(mode)) return false;
  if (['docker-local', 'local-filesystem'].includes(mode)) return true;
  return !enabled(env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || env.EXTERNAL_MEDIA_PUBLISH_ENABLED);
}

function imageError(message, code = 'ANTHROPIC_VISION_IMAGE_INVALID') {
  const error = new Error(message);
  error.name = 'AnthropicVisionImageError';
  error.code = code;
  return error;
}

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function checkedImage(bytes, maxEncodedImageBytes) {
  if (!bytes.length) throw imageError('Native Claude vision image is empty.');
  if (4 * Math.ceil(bytes.length / 3) > maxEncodedImageBytes) {
    throw imageError('Native Claude vision image exceeds the base64 size limit.', 'ANTHROPIC_VISION_IMAGE_TOO_LARGE');
  }
  const media_type = imageType(bytes);
  if (!media_type) throw imageError('Native Claude vision requires a PNG, JPEG, GIF, or WebP image.');
  return { type: 'base64', media_type, data: bytes.toString('base64') };
}

function withinRoot(file, root) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function localRoots(env) {
  return {
    assets_v2: path.resolve(env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2'),
    assets: path.resolve(env.SAMSAR_ASSETS_ROOT || '/assets'),
  };
}

async function ownedMediaHosts(env) {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', 'processor', 'media-gateway', 'host.docker.internal']);
  function add(value) {
    try { hosts.add(new URL(value).hostname.toLowerCase()); } catch { /* Optional URL is absent or invalid. */ }
  }
  OWNED_MEDIA_ENV_KEYS.forEach(key => add(env[key]));
  const configs = new Set([
    env.SAMSAR_RUNTIME_CONFIG_FILE, env.SAMSAR_CONFIG_FILE, '/persistent/config/samsar.config.json',
  ].filter(Boolean));
  for (const file of configs) {
    try {
      const config = JSON.parse(await fs.readFile(file, 'utf8'));
      for (const tunnel of [config.localMediaTunnel, config.mediaTunnel]) {
        if (tunnel?.enabled !== false) { add(tunnel?.publicUrl); add(tunnel?.url); }
      }
      add(config.publicUrls?.media);
    } catch { /* Local runtime configuration is optional. */ }
  }
  return hosts;
}

async function readLocalImage(reference, env, maxRawBytes) {
  let filePath;
  try { filePath = decodeURIComponent(reference.split('?')[0].split('#')[0]).replace(/\\/g, '/'); }
  catch { throw imageError('Native Claude vision image path is invalid.'); }
  if (filePath.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(filePath)) {
    throw imageError('Native Claude vision image reference is unsupported.');
  }
  const key = filePath.replace(/^\/+/, '');
  const isMediaAlias = LOCAL_MEDIA_ALIASES.some(alias => key.startsWith(`${alias}/`));
  const candidates = [];
  for (const [kind, root] of Object.entries(localRoots(env))) {
    if (key.startsWith(`${kind}/`)) candidates.push({ root, file: path.resolve(root, key.slice(kind.length + 1)) });
    else if (isMediaAlias) candidates.push({ root, file: path.resolve(root, key) });
    else if (path.isAbsolute(filePath)) candidates.push({ root, file: path.resolve(filePath) });
  }
  for (const { root, file } of candidates) {
    if (!withinRoot(file, root)) continue;
    let realRoot, realFile, stat;
    try {
      [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
      if (!withinRoot(realFile, realRoot)) continue;
      stat = await fs.stat(realFile);
    } catch { continue; }
    if (!stat.isFile()) continue;
    if (stat.size > maxRawBytes) {
      throw imageError('Native Claude vision image exceeds the base64 size limit.', 'ANTHROPIC_VISION_IMAGE_TOO_LARGE');
    }
    return fs.readFile(realFile);
  }
  return null;
}

// The native adapter calls this after chat-to-Messages translation. Other
// adapters never enter this path; cloud-hosted images remain URL references.
export async function inlineAnthropicVisionImages(body, {
  env = process.env, maxEncodedImageBytes = MAX_ENCODED_IMAGE_BYTES,
} = {}) {
  if (!usesLocalAnthropicVisionImages(env)) return body;
  if (!Number.isSafeInteger(maxEncodedImageBytes) || maxEncodedImageBytes < 4) {
    throw imageError('Native Claude vision image size limit is invalid.');
  }
  const maxRawBytes = Math.floor(maxEncodedImageBytes / 4) * 3;
  const images = new Map();
  let hosts;
  async function inlineSource(source) {
    const reference = source.url;
    if (typeof reference !== 'string' || !reference.trim()) throw imageError('Native Claude vision image reference is missing.');
    let localReference = reference;
    let remote = false;
    if (/^https?:\/\//i.test(reference)) {
      let url;
      try { url = new URL(reference); } catch { return source; }
      hosts ||= await ownedMediaHosts(env);
      if (!hosts.has(url.hostname.toLowerCase())) return source;
      localReference = url.pathname;
      // Public media bases may include an installation prefix before assets.
      const match = localReference.match(/\/(assets_v2|assets|generations|temp_images|user_resources|video|ai_video)\//);
      if (match) localReference = localReference.slice(match.index);
      remote = true;
    }
    if (!images.has(localReference)) {
      const bytes = await readLocalImage(localReference, env, maxRawBytes);
      if (!bytes) {
        if (remote) return source;
        throw imageError('Native Claude vision image is not available inside an allowed media root.');
      }
      images.set(localReference, checkedImage(bytes, maxEncodedImageBytes));
    }
    return images.get(localReference);
  }
  async function inlineContent(content) {
    if (!Array.isArray(content)) return content;
    const result = [];
    for (const block of content) {
      if (block?.type === 'image' && block.source?.type === 'url') {
        result.push({ ...block, source: await inlineSource(block.source) });
      } else if (block?.type === 'tool_result' && Array.isArray(block.content)) {
        result.push({ ...block, content: await inlineContent(block.content) });
      } else result.push(block);
    }
    return result;
  }
  const messages = [];
  for (const message of body.messages || []) messages.push({ ...message, content: await inlineContent(message.content) });
  return { ...body, messages };
}
