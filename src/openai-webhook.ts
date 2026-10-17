import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_OPENAI_WEBHOOK_BYTES = 1_048_576;
const DEFAULT_TOLERANCE_SECONDS = 300;

export interface OpenAIWebhookHeaders {
  readonly id?: string;
  readonly timestamp?: string;
  readonly signature?: string;
}

export interface OpenAIWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly data?: unknown;
  readonly [key: string]: unknown;
}

export class OpenAIWebhookError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function decodeSecret(secret: string): Buffer {
  const value = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length > 0 && decoded.toString('base64').replace(/=+$/u, '') === value.replace(/=+$/u, '')) return decoded;
  } catch {
    // Fall through to UTF-8 for development/test secrets.
  }
  return Buffer.from(secret, 'utf8');
}

function signatureCandidates(header: string): string[] {
  return header.split(' ').flatMap((part) => {
    const separator = part.indexOf(',');
    return separator < 0 ? [] : [part.slice(separator + 1)];
  }).filter((value) => value.length > 0);
}

function signaturesMatch(expected: string, candidate: string): boolean {
  let actual: Buffer;
  try {
    actual = Buffer.from(candidate, 'base64');
  } catch {
    return false;
  }
  const expectedBytes = Buffer.from(expected, 'base64');
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

export function verifyOpenAIWebhookSignature(
  rawBody: string,
  headers: OpenAIWebhookHeaders,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS
): void {
  if (!headers.id || !headers.timestamp || !headers.signature) {
    throw new OpenAIWebhookError(401, 'invalid_webhook_signature', 'Required webhook signature headers are missing');
  }
  const timestamp = Number(headers.timestamp);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new OpenAIWebhookError(401, 'invalid_webhook_signature', 'Webhook timestamp is outside the allowed tolerance');
  }
  const signedPayload = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = createHmac('sha256', decodeSecret(secret)).update(signedPayload).digest('base64');
  if (!signatureCandidates(headers.signature).some((candidate) => signaturesMatch(expected, candidate))) {
    throw new OpenAIWebhookError(401, 'invalid_webhook_signature', 'Webhook signature verification failed');
  }
}

export function parseOpenAIWebhookEvent(rawBody: string): OpenAIWebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new OpenAIWebhookError(400, 'invalid_json', 'Request body must contain valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenAIWebhookError(400, 'invalid_webhook_event', 'Webhook event must be a JSON object');
  }
  const event = value as Record<string, unknown>;
  if (typeof event.id !== 'string' || event.id.length === 0 || typeof event.type !== 'string' || event.type.length === 0) {
    throw new OpenAIWebhookError(400, 'invalid_webhook_event', 'Webhook event must contain string id and type fields');
  }
  return event as OpenAIWebhookEvent;
}
