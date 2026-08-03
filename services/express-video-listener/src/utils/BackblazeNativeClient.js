import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export const BACKBLAZE_CREDENTIAL_TYPE_APPLICATION = 'application';
export const BACKBLAZE_CREDENTIAL_TYPE_MASTER = 'master';

const AUTHORIZE_ACCOUNT_URL = 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account';
const AUTHORIZATION_CACHE_MS = 23 * 60 * 60 * 1000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeBackblazeCredentialType(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (['master', 'master-key', 'account'].includes(normalized)) {
    return BACKBLAZE_CREDENTIAL_TYPE_MASTER;
  }
  if (['application', 'app', 'app-key', 'standard'].includes(normalized)) {
    return BACKBLAZE_CREDENTIAL_TYPE_APPLICATION;
  }
  return '';
}

export function shouldUseBackblazeNativeApi(env = process.env) {
  const backend = normalizeString(env.SAMSAR_STORAGE_BACKEND).toLowerCase();
  const credentialType = normalizeBackblazeCredentialType(
    env.SAMSAR_BACKBLAZE_CREDENTIAL_TYPE || env.BACKBLAZE_CREDENTIAL_TYPE,
  );
  return backend === 'backblaze-b2' && credentialType === BACKBLAZE_CREDENTIAL_TYPE_MASTER;
}

function encodeFileName(value) {
  return encodeURIComponent(normalizeString(value).replace(/^\/+/, ''));
}

function encodeDownloadPath(value) {
  return normalizeString(value)
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildUploadMetadataHeaders(input = {}) {
  const mappings = [
    ['CacheControl', 'X-Bz-Info-b2-cache-control'],
    ['ContentDisposition', 'X-Bz-Info-b2-content-disposition'],
    ['ContentEncoding', 'X-Bz-Info-b2-content-encoding'],
    ['ContentLanguage', 'X-Bz-Info-b2-content-language'],
    ['Expires', 'X-Bz-Info-b2-expires'],
  ];
  return Object.fromEntries(mappings.flatMap(([inputKey, headerName]) => {
    const configured = input[inputKey] instanceof Date
      ? input[inputKey].toUTCString()
      : normalizeString(input[inputKey]);
    return configured ? [[headerName, encodeURIComponent(configured)]] : [];
  }));
}

async function responseError(response, operation) {
  const responseText = await response.text().catch(() => '');
  let body = {};
  try {
    body = JSON.parse(responseText);
  } catch {}
  const error = new Error(
    normalizeString(body.message) ||
    `${operation} failed with HTTP ${response.status}.`,
  );
  error.name = normalizeString(body.code) || `Backblaze${operation}Error`;
  error.Code = normalizeString(body.code) || undefined;
  error.statusCode = response.status;
  error.$metadata = {
    httpStatusCode: response.status,
    requestId: response.headers.get('x-bz-request-id') || undefined,
  };
  return error;
}

async function responseJson(response, operation) {
  if (!response.ok) {
    throw await responseError(response, operation);
  }
  return response.json();
}

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }
  if (stream instanceof Uint8Array) {
    return Buffer.from(stream);
  }
  if (typeof stream === 'string') {
    return Buffer.from(stream);
  }
  if (stream && typeof stream.arrayBuffer === 'function') {
    return Buffer.from(await stream.arrayBuffer());
  }
  const chunks = [];
  for await (const chunk of stream || []) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function hashFile(filePath) {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function prepareUploadBody(body, configuredLength) {
  if (body?.path && typeof body.path === 'string') {
    const fileStats = await stat(body.path);
    return {
      contentLength: Number(configuredLength) || fileStats.size,
      contentSha1: await hashFile(body.path),
      createBody: () => createReadStream(body.path),
      streaming: true,
    };
  }

  const buffer = await streamToBuffer(body);
  return {
    contentLength: Number(configuredLength) || buffer.length,
    contentSha1: createHash('sha1').update(buffer).digest('hex'),
    createBody: () => buffer,
    streaming: false,
  };
}

function buildSdkBody(responseBody) {
  const body = Readable.fromWeb(responseBody);
  body.transformToByteArray = async () => new Uint8Array(await streamToBuffer(body));
  body.transformToString = async (encoding = 'utf8') => (await streamToBuffer(body)).toString(encoding);
  body.transformToWebStream = () => Readable.toWeb(body);
  return body;
}

function parseCopySource(value) {
  const decoded = decodeURIComponent(normalizeString(value)).replace(/^\/+/, '');
  const separatorIndex = decoded.indexOf('/');
  if (separatorIndex <= 0) {
    throw new Error('Backblaze native copy requires a bucket and object key.');
  }
  return {
    bucketName: decoded.slice(0, separatorIndex),
    key: decoded.slice(separatorIndex + 1),
  };
}

export class BackblazeNativeClient {
  constructor({
    applicationKeyId,
    applicationKey,
    bucketName,
    region,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.applicationKeyId = normalizeString(applicationKeyId);
    this.applicationKey = normalizeString(applicationKey);
    this.defaultBucketName = normalizeString(bucketName);
    this.region = normalizeString(region);
    this.fetchImpl = fetchImpl;
    this.authorization = null;
    this.authorizationPromise = null;
    this.bucketIds = new Map();
    this.config = {};
  }

  async authorize(force = false) {
    if (
      !force &&
      this.authorization &&
      Date.now() - this.authorization.authorizedAt < AUTHORIZATION_CACHE_MS
    ) {
      return this.authorization;
    }
    if (!force && this.authorizationPromise) {
      return this.authorizationPromise;
    }
    if (!this.applicationKeyId || !this.applicationKey) {
      throw new Error('Backblaze native storage requires a master key ID and key value.');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Backblaze native storage requires fetch support.');
    }

    this.authorizationPromise = (async () => {
      const response = await this.fetchImpl(AUTHORIZE_ACCOUNT_URL, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.applicationKeyId}:${this.applicationKey}`).toString('base64')}`,
        },
      });
      const body = await responseJson(response, 'AuthorizeAccount');
      if (normalizeString(body.accountId) !== this.applicationKeyId) {
        throw new Error('Configured Backblaze credential type is master, but the supplied key ID is a standard application key ID.');
      }
      const storageApi = body.apiInfo?.storageApi || {};
      const allowed = storageApi.allowed || {};
      if (!Array.isArray(allowed.capabilities) || !allowed.capabilities.includes('writeFiles')) {
        throw new Error('The Backblaze master key does not have writeFiles capability.');
      }
      this.authorization = {
        accountId: body.accountId,
        authorizationToken: body.authorizationToken,
        apiUrl: storageApi.apiUrl,
        downloadUrl: storageApi.downloadUrl,
        allowed,
        authorizedAt: Date.now(),
      };
      return this.authorization;
    })();

    try {
      return await this.authorizationPromise;
    } finally {
      this.authorizationPromise = null;
    }
  }

  async apiCall(operation, payload, retry = true) {
    const authorization = await this.authorize();
    const response = await this.fetchImpl(
      `${authorization.apiUrl}/b2api/v4/${operation}`,
      {
        method: 'POST',
        headers: {
          Authorization: authorization.authorizationToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (response.status === 401 && retry) {
      await this.authorize(true);
      return this.apiCall(operation, payload, false);
    }
    return responseJson(response, operation);
  }

  async getBucketId(bucketName = this.defaultBucketName) {
    const normalizedBucketName = normalizeString(bucketName);
    if (!normalizedBucketName) {
      throw new Error('Backblaze native storage requires a bucket name.');
    }
    if (this.bucketIds.has(normalizedBucketName)) {
      return this.bucketIds.get(normalizedBucketName);
    }
    const authorization = await this.authorize();
    const allowedBuckets = Array.isArray(authorization.allowed?.buckets)
      ? authorization.allowed.buckets
      : [];
    let bucket = allowedBuckets.find((item) => (
      normalizeString(item?.name || item?.bucketName) === normalizedBucketName
    ));
    if (!bucket) {
      const result = await this.apiCall('b2_list_buckets', {
        accountId: authorization.accountId,
        bucketName: normalizedBucketName,
      });
      bucket = (result.buckets || []).find((item) => item.bucketName === normalizedBucketName);
    }
    const bucketId = normalizeString(bucket?.id || bucket?.bucketId);
    if (!bucketId) {
      throw new Error(`Backblaze bucket "${normalizedBucketName}" was not found for this master key.`);
    }
    this.bucketIds.set(normalizedBucketName, bucketId);
    return bucketId;
  }

  async putObject(input) {
    const bucketName = normalizeString(input.Bucket) || this.defaultBucketName;
    const bucketId = await this.getBucketId(bucketName);
    const preparedBody = await prepareUploadBody(input.Body, input.ContentLength);
    let lastError;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const uploadTarget = await this.apiCall('b2_get_upload_url', { bucketId });
      const response = await this.fetchImpl(uploadTarget.uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: uploadTarget.authorizationToken,
          'Content-Type': normalizeString(input.ContentType) || 'b2/x-auto',
          'Content-Length': String(preparedBody.contentLength),
          'X-Bz-Content-Sha1': preparedBody.contentSha1,
          'X-Bz-File-Name': encodeFileName(input.Key),
          ...buildUploadMetadataHeaders(input),
        },
        body: preparedBody.createBody(),
        ...(preparedBody.streaming ? { duplex: 'half' } : {}),
      });
      if (response.ok) {
        const body = await response.json();
        return {
          ETag: body.contentSha1 ? `"${body.contentSha1}"` : undefined,
          VersionId: body.fileId,
          $metadata: {
            httpStatusCode: response.status,
            requestId: response.headers.get('x-bz-request-id') || undefined,
          },
        };
      }
      lastError = await responseError(response, 'UploadFile');
      if (response.status !== 401) {
        break;
      }
    }
    throw lastError;
  }

  async getObject(input) {
    const bucketName = normalizeString(input.Bucket) || this.defaultBucketName;
    const authorization = await this.authorize();
    const response = await this.fetchImpl(
      `${authorization.downloadUrl}/file/${encodeURIComponent(bucketName)}/${encodeDownloadPath(input.Key)}`,
      { headers: { Authorization: authorization.authorizationToken } },
    );
    if (!response.ok) {
      throw await responseError(response, 'DownloadFileByName');
    }
    return {
      Body: buildSdkBody(response.body),
      ContentLength: Number(response.headers.get('content-length')) || undefined,
      ContentType: response.headers.get('content-type') || undefined,
      ETag: response.headers.get('x-bz-content-sha1') || response.headers.get('etag') || undefined,
      LastModified: response.headers.get('last-modified')
        ? new Date(response.headers.get('last-modified'))
        : undefined,
      $metadata: {
        httpStatusCode: response.status,
        requestId: response.headers.get('x-bz-request-id') || undefined,
      },
    };
  }

  async listObjects(input) {
    const bucketId = await this.getBucketId(input.Bucket);
    const result = await this.apiCall('b2_list_file_names', {
      bucketId,
      prefix: normalizeString(input.Prefix),
      startFileName: normalizeString(input.ContinuationToken) || undefined,
      maxFileCount: Math.min(10_000, Math.max(1, Number(input.MaxKeys) || 1_000)),
    });
    return {
      Contents: (result.files || []).map((file) => ({
        Key: file.fileName,
        Size: file.contentLength,
        ETag: file.contentSha1 ? `"${file.contentSha1}"` : undefined,
        LastModified: file.uploadTimestamp ? new Date(file.uploadTimestamp) : undefined,
      })),
      IsTruncated: Boolean(result.nextFileName),
      NextContinuationToken: result.nextFileName || undefined,
      $metadata: { httpStatusCode: 200 },
    };
  }

  async findVisibleFile(bucketName, key) {
    const bucketId = await this.getBucketId(bucketName);
    const result = await this.apiCall('b2_list_file_names', {
      bucketId,
      startFileName: normalizeString(key),
      maxFileCount: 1,
    });
    const file = (result.files || [])[0];
    if (!file || file.fileName !== normalizeString(key)) {
      const error = new Error(`Backblaze object "${key}" was not found.`);
      error.name = 'NoSuchKey';
      error.Code = 'NoSuchKey';
      throw error;
    }
    return { bucketId, file };
  }

  async copyObject(input) {
    const source = parseCopySource(input.CopySource);
    const { file } = await this.findVisibleFile(source.bucketName, source.key);
    const destinationBucketId = await this.getBucketId(input.Bucket);
    const result = await this.apiCall('b2_copy_file', {
      sourceFileId: file.fileId,
      fileName: normalizeString(input.Key),
      destinationBucketId,
      metadataDirective: 'COPY',
    });
    return {
      CopyObjectResult: {
        ETag: result.contentSha1 ? `"${result.contentSha1}"` : undefined,
        LastModified: result.uploadTimestamp ? new Date(result.uploadTimestamp) : undefined,
      },
      VersionId: result.fileId,
      $metadata: { httpStatusCode: 200 },
    };
  }

  async deleteObject(input) {
    const bucketId = await this.getBucketId(input.Bucket);
    const result = await this.apiCall('b2_hide_file', {
      bucketId,
      fileName: normalizeString(input.Key),
    });
    return {
      VersionId: result.fileId,
      DeleteMarker: true,
      $metadata: { httpStatusCode: 200 },
    };
  }

  async deleteObjects(input) {
    const deleted = [];
    const errors = [];
    for (const object of input.Delete?.Objects || []) {
      try {
        await this.deleteObject({ Bucket: input.Bucket, Key: object.Key });
        deleted.push({ Key: object.Key });
      } catch (error) {
        errors.push({
          Key: object.Key,
          Code: error.Code || error.name || 'DeleteFailed',
          Message: error.message,
        });
      }
    }
    return {
      Deleted: deleted,
      Errors: errors,
      $metadata: { httpStatusCode: errors.length ? 207 : 200 },
    };
  }

  async send(command) {
    const input = command?.input || {};
    switch (command?.constructor?.name) {
      case 'PutObjectCommand':
        return this.putObject(input);
      case 'GetObjectCommand':
        return this.getObject(input);
      case 'ListObjectsV2Command':
        return this.listObjects(input);
      case 'CopyObjectCommand':
        return this.copyObject(input);
      case 'DeleteObjectCommand':
        return this.deleteObject(input);
      case 'DeleteObjectsCommand':
        return this.deleteObjects(input);
      case 'GetBucketLocationCommand':
        return {
          LocationConstraint: this.region || undefined,
          $metadata: { httpStatusCode: 200 },
        };
      default:
        throw new Error(`Backblaze native storage does not support ${command?.constructor?.name || 'this command'}.`);
    }
  }

  destroy() {}
}

export function createBackblazeNativeClientFromEnv(env = process.env, options = {}) {
  return new BackblazeNativeClient({
    applicationKeyId: env.AWS_ACCESS_KEY_ID,
    applicationKey: env.AWS_SECRET_ACCESS_KEY,
    bucketName: env.MEDIA_BUCKET_NAME || env.STATIC_CDN_BUCKET,
    region: env.AWS_REGION || env.AWS_CDN_REGION,
    ...options,
  });
}
