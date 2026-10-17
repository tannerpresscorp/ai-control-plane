import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_OPENAI_WEBHOOK_BYTES, OpenAIWebhookError, parseOpenAIWebhookEvent, verifyOpenAIWebhookSignature } from './openai-webhook.js';

export interface OpenAIWebhookHttpOptions {
  readonly secret?: string;
  readonly now?: () => Date;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload).toString(),
    'cache-control': 'no-store'
  });
  response.end(payload);
}

function readRawBody(request: IncomingMessage): Promise<string> {
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_OPENAI_WEBHOOK_BYTES) {
    request.resume();
    return Promise.reject(new OpenAIWebhookError(413, 'payload_too_large', `Webhook body must not exceed ${MAX_OPENAI_WEBHOOK_BYTES} bytes`));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (error: OpenAIWebhookError) => {
      if (settled) return;
      settled = true;
      request.resume();
      reject(error);
    };
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_OPENAI_WEBHOOK_BYTES) {
        fail(new OpenAIWebhookError(413, 'payload_too_large', `Webhook body must not exceed ${MAX_OPENAI_WEBHOOK_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.once('error', () => fail(new OpenAIWebhookError(400, 'invalid_request', 'Unable to read webhook body')));
  });
}

export async function handleOpenAIWebhook(request: IncomingMessage, response: ServerResponse, options: OpenAIWebhookHttpOptions): Promise<void> {
  if (request.method !== 'POST') {
    request.resume();
    writeJson(response, 405, { error: 'method_not_allowed', allowedMethods: ['POST'] });
    return;
  }
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    writeJson(response, 415, { error: 'unsupported_media_type', message: 'Content-Type must be application/json' });
    return;
  }
  if (!options.secret?.trim()) {
    request.resume();
    writeJson(response, 503, { error: 'webhook_not_configured', message: 'OpenAI webhook signing secret is not configured' });
    return;
  }
  try {
    const rawBody = await readRawBody(request);
    verifyOpenAIWebhookSignature(rawBody, {
      id: request.headers['webhook-id'] as string | undefined,
      timestamp: request.headers['webhook-timestamp'] as string | undefined,
      signature: request.headers['webhook-signature'] as string | undefined
    }, options.secret, (options.now ?? (() => new Date()))());
    const event = parseOpenAIWebhookEvent(rawBody);
    writeJson(response, 200, { received: true, eventId: event.id, eventType: event.type });
  } catch (error) {
    if (error instanceof OpenAIWebhookError) {
      writeJson(response, error.statusCode, { error: error.code, message: error.message });
      return;
    }
    writeJson(response, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request' });
  }
}
