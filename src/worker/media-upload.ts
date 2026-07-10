import { ALLOWED_MEDIA_TYPES, FILE_SIZE_LIMITS } from '../utils/validation.js';
import { ApiError } from './tenant-context.js';

export const MAX_STAGED_MEDIA_BYTES = Math.max(...Object.values(FILE_SIZE_LIMITS));

export interface R2MediaUploadBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<{ key?: string; size?: number; etag?: string } | null>;
}

export interface StagedMediaUpload {
  r2Key: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * 将已认证请求中的原始媒体字节流写入租户/账号隔离的 R2 前缀。
 */
export async function stageMediaUpload(
  request: Request,
  options: {
    bucket?: R2MediaUploadBucket;
    tenantId: string;
    accountId: string;
    userId: string;
    requestId: string;
    now?: Date;
  },
): Promise<StagedMediaUpload> {
  if (!options.bucket?.put) {
    throw new ApiError('media_storage_unavailable', 'R2 MEDIA binding is not configured.', 503);
  }

  const url = new URL(request.url);
  const fileName = sanitizeFileName(url.searchParams.get('filename'));
  const mimeType = normalizeMimeType(request.headers.get('content-type'));
  if (!(ALLOWED_MEDIA_TYPES as readonly string[]).includes(mimeType)) {
    throw new ApiError(
      'unsupported_media_type',
      `Unsupported media type: ${mimeType || 'missing'}.`,
      415,
      { allowed: ALLOWED_MEDIA_TYPES },
    );
  }

  const declaredSize = parseContentLength(request.headers.get('content-length'));
  if (declaredSize !== undefined && declaredSize > MAX_STAGED_MEDIA_BYTES) {
    throw mediaTooLargeError(declaredSize);
  }
  if (!request.body) {
    throw new ApiError('empty_media', 'Media request body is required.', 400);
  }

  const mediaBytes = await readStreamBytes(request.body, MAX_STAGED_MEDIA_BYTES);
  const actualSize = mediaBytes.byteLength;
  if (actualSize === 0) {
    throw new ApiError('empty_media', 'Media request body is empty.', 400);
  }
  const prefix = mediaBytes.subarray(0, 32);
  if (!matchesMediaSignature(prefix, mimeType)) {
    throw new ApiError(
      'media_signature_mismatch',
      `The uploaded bytes do not match Content-Type ${mimeType}.`,
      415,
    );
  }

  const now = options.now ?? new Date();
  const r2Key = createMediaUploadKey(options.tenantId, options.accountId, fileName, now);
  await options.bucket.put(r2Key, mediaBytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      tenantId: options.tenantId,
      accountId: options.accountId,
      originalFileName: fileName,
      uploadedAt: now.toISOString(),
      uploadedBy: options.userId,
      requestId: options.requestId,
    },
  });

  return {
    r2Key,
    fileName,
    mimeType,
    size: actualSize,
  };
}

export function createMediaUploadPrefix(tenantId: string, accountId: string): string {
  return `staging/tenants/${safeKeySegment(tenantId)}/accounts/${safeKeySegment(accountId)}/uploads/`;
}

function createMediaUploadKey(tenantId: string, accountId: string, fileName: string, now: Date): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${createMediaUploadPrefix(tenantId, accountId)}${year}/${month}/${day}/${crypto.randomUUID()}-${fileName}`;
}

function safeKeySegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  return normalized || 'unknown';
}

function sanitizeFileName(value: string | null): string {
  const baseName = (value ?? '').trim().split(/[\\/]/).pop() ?? '';
  const normalized = baseName
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  if (!normalized) {
    throw new ApiError('missing_filename', 'Query parameter filename is required.', 400);
  }
  return normalized;
}

function normalizeMimeType(value: string | null): string {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ApiError('invalid_content_length', 'Content-Length must be a non-negative integer.', 400);
  }
  return size;
}

function mediaTooLargeError(size: number): ApiError {
  return new ApiError(
    'media_too_large',
    `Media exceeds the ${MAX_STAGED_MEDIA_BYTES} byte staging limit.`,
    413,
    { size, maxBytes: MAX_STAGED_MEDIA_BYTES },
  );
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw mediaTooLargeError(total);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 1 && chunks[0].byteOffset === 0 && chunks[0].byteLength === chunks[0].buffer.byteLength) {
    return chunks[0];
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function matchesMediaSignature(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
    case 'image/bmp':
      return ascii(bytes, 0, 2) === 'BM';
    case 'audio/mp3':
    case 'audio/mpeg':
      return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'audio/amr':
      return ascii(bytes, 0, 6) === '#!AMR\n';
    case 'video/mp4':
      return ascii(bytes, 4, 4) === 'ftyp';
    default:
      return false;
  }
}

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.byteLength < offset + length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
