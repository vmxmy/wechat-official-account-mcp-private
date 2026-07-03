import CryptoJS from 'crypto-js';
import type { InboundMessageInsert } from './inbox-store.js';

export interface InboundMessageWriter {
  insertMessage(message: InboundMessageInsert): Promise<{ inserted: boolean }>;
}

export interface WechatWebhookOptions {
  token: string | null | undefined;
  appId: string | null | undefined;
  encodingAESKey?: string | null;
  inboxStore: InboundMessageWriter;
  tenantId?: string | null;
  accountId?: string | null;
  now?: () => number;
  maxBodyBytes?: number;
}

export const DEFAULT_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;

export async function handleWechatWebhook(
  request: Request,
  options: WechatWebhookOptions,
): Promise<Response> {
  const url = new URL(request.url);
  const token = options.token;

  if (!token) {
    return new Response('Webhook token is not configured.', { status: 500 });
  }

  if (request.method === 'GET') {
    return handleWebhookHandshake(url, token);
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, POST' },
    });
  }

  const receivedAt = options.now?.() ?? Date.now();
  const encrypted = url.searchParams.get('encrypt_type') === 'aes';
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_WEBHOOK_BODY_LIMIT_BYTES;

  try {
    const outerXml = await readRequestTextWithLimit(request, maxBodyBytes);
    const { rawXml, parsedPayload } = encrypted
      ? await verifyAndDecryptEncryptedMessage(url, outerXml, options, maxBodyBytes)
      : verifyPlaintextMessage(url, outerXml, token);

    const inboundMessage = toInboundMessageInsert(parsedPayload, rawXml, receivedAt, {
      tenantId: options.tenantId,
      accountId: options.accountId,
    });
    await options.inboxStore.insertMessage(inboundMessage);

    return new Response('success', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('signature') || message.includes('appid') ? 403 : 400;
    return new Response(message, { status });
  }
}

export function createWechatSignature(values: Array<string | null | undefined>): string {
  return CryptoJS.SHA1(
    values
      .filter((value): value is string => value !== undefined && value !== null)
      .sort()
      .join(''),
  ).toString();
}

export function parseWechatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
  const content = xml
    .trim()
    .replace(/^<xml>/i, '')
    .replace(/<\/xml>$/i, '');

  for (const match of content.matchAll(pattern)) {
    const [, key, cdataValue, plainValue] = match;
    if (key === 'xml') continue;
    result[key] = cdataValue ?? decodeXmlEntities((plainValue ?? '').trim());
  }

  return result;
}

export function decryptWechatMessage(
  encrypt: string,
  encodingAESKey: string,
  expectedAppId: string | null | undefined,
  maxXmlBytes = DEFAULT_WEBHOOK_BODY_LIMIT_BYTES,
): string {
  const key = parseEncodingAESKey(encodingAESKey);
  const iv = CryptoJS.lib.WordArray.create(key.words.slice(0, 4), 16);
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(encrypt),
  });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const bytes = wordArrayToUint8Array(decrypted);

  if (bytes.byteLength < 20) {
    throw new Error('Invalid encrypted payload: too short');
  }

  const messageLength = new DataView(
    bytes.buffer,
    bytes.byteOffset + 16,
    4,
  ).getUint32(0, false);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageEnd > bytes.byteLength) {
    throw new Error('Invalid encrypted payload: message length out of range');
  }
  if (messageLength > maxXmlBytes) {
    throw new Error(`Webhook decrypted XML exceeds ${maxXmlBytes} bytes`);
  }

  const decoder = new TextDecoder();
  const messageXml = decoder.decode(bytes.slice(messageStart, messageEnd));
  const appId = decoder.decode(bytes.slice(messageEnd));

  if (expectedAppId && appId !== expectedAppId) {
    throw new Error('Invalid encrypted payload appid');
  }

  return messageXml;
}

export function createInboundDedupKey(
  payload: Record<string, string>,
  scope: { tenantId?: string | null; accountId?: string | null } = {},
): string {
  const baseKey = payload.MsgId
    ? payload.MsgId
    : createEventDedupKey(payload);

  if (!scope.accountId) {
    return baseKey;
  }

  return [
    'account',
    scope.tenantId || 'default',
    scope.accountId,
    baseKey,
  ].join(':');
}

function createEventDedupKey(payload: Record<string, string>): string {
  const stableParts = [
    payload.FromUserName,
    payload.ToUserName,
    payload.CreateTime,
    payload.MsgType,
    payload.Event,
    payload.EventKey,
    payload.Ticket,
    payload.Latitude,
    payload.Longitude,
    payload.Precision,
    payload.MediaId,
  ].filter(Boolean).join('|');

  return `event:${CryptoJS.SHA1(stableParts || JSON.stringify(payload)).toString()}`;
}

function handleWebhookHandshake(url: URL, token: string): Response {
  const signature = url.searchParams.get('signature');
  const timestamp = url.searchParams.get('timestamp');
  const nonce = url.searchParams.get('nonce');
  const echostr = url.searchParams.get('echostr');

  if (!signature || !timestamp || !nonce || echostr === null) {
    return new Response('Missing signature parameters.', { status: 400 });
  }

  const expected = createWechatSignature([token, timestamp, nonce]);
  if (!constantTimeEqual(signature, expected)) {
    return new Response('Invalid plaintext signature.', { status: 403 });
  }

  return new Response(echostr, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function verifyPlaintextMessage(
  url: URL,
  rawXml: string,
  token: string,
): { rawXml: string; parsedPayload: Record<string, string> } {
  const signature = url.searchParams.get('signature');
  const timestamp = url.searchParams.get('timestamp');
  const nonce = url.searchParams.get('nonce');

  if (!signature || !timestamp || !nonce) {
    throw new Error('Missing plaintext signature parameters');
  }

  const expected = createWechatSignature([token, timestamp, nonce]);
  if (!constantTimeEqual(signature, expected)) {
    throw new Error('Invalid plaintext signature');
  }

  return {
    rawXml,
    parsedPayload: parseWechatXml(rawXml),
  };
}

async function verifyAndDecryptEncryptedMessage(
  url: URL,
  outerXml: string,
  options: WechatWebhookOptions,
  maxBodyBytes: number,
): Promise<{ rawXml: string; parsedPayload: Record<string, string> }> {
  const timestamp = url.searchParams.get('timestamp');
  const nonce = url.searchParams.get('nonce');
  const msgSignature = url.searchParams.get('msg_signature');
  const outerPayload = parseWechatXml(outerXml);
  const encrypt = outerPayload.Encrypt;

  if (!timestamp || !nonce || !msgSignature || !encrypt) {
    throw new Error('Missing encrypted signature parameters');
  }
  if (!options.encodingAESKey) {
    throw new Error('EncodingAESKey is not configured');
  }

  const expected = createWechatSignature([options.token, timestamp, nonce, encrypt]);
  if (!constantTimeEqual(msgSignature, expected)) {
    throw new Error('Invalid encrypted msg_signature');
  }

  const rawXml = decryptWechatMessage(encrypt, options.encodingAESKey, options.appId, maxBodyBytes);
  return {
    rawXml,
    parsedPayload: parseWechatXml(rawXml),
  };
}

function toInboundMessageInsert(
  payload: Record<string, string>,
  rawXml: string,
  receivedAt: number,
  scope: { tenantId?: string | null; accountId?: string | null } = {},
): InboundMessageInsert {
  if (!payload.ToUserName || !payload.FromUserName || !payload.MsgType) {
    throw new Error('Invalid WeChat XML payload: missing required fields');
  }

  return {
    tenantId: scope.tenantId ?? null,
    accountId: scope.accountId ?? null,
    dedupKey: createInboundDedupKey(payload, scope),
    toUserName: payload.ToUserName,
    fromUserName: payload.FromUserName,
    type: payload.MsgType,
    eventType: payload.MsgType === 'event' ? payload.Event ?? null : null,
    rawXml,
    parsedPayload: payload,
    createTime: Number(payload.CreateTime ?? Math.floor(receivedAt / 1000)),
    receivedAt,
  };
}

function parseEncodingAESKey(encodingAESKey: string): CryptoJS.lib.WordArray {
  if (encodingAESKey.length !== 43) {
    throw new Error('EncodingAESKey must be 43 characters');
  }

  const padded = `${encodingAESKey}${'='.repeat((4 - (encodingAESKey.length % 4)) % 4)}`;
  const key = CryptoJS.enc.Base64.parse(padded);
  if (key.sigBytes !== 32) {
    throw new Error('EncodingAESKey must decode to 32 bytes');
  }
  return key;
}

function wordArrayToUint8Array(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const bytes = new Uint8Array(wordArray.sigBytes);
  for (let index = 0; index < wordArray.sigBytes; index += 1) {
    bytes[index] = (wordArray.words[index >>> 2] >>> (24 - (index % 4) * 8)) & 0xff;
  }
  return bytes;
}

async function readRequestTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) {
    throw new Response(`Webhook payload exceeds ${maxBytes} bytes`, { status: 413 });
  }

  if (!request.body) {
    const text = await request.text();
    assertTextByteLength(text, maxBytes);
    return text;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        throw new Response(`Webhook payload exceeds ${maxBytes} bytes`, { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function assertTextByteLength(value: string, maxBytes: number): void {
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Response(`Webhook payload exceeds ${maxBytes} bytes`, { status: 413 });
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
