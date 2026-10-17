import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleOpenAIWebhook } from './openai-webhook-http.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './package-metadata.js';
import { MAX_VERIFICATION_INPUT_BYTES, verifyAcceptanceInput } from './verification-input.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_SERVICE_NAME = 'ai-control-plane-api';

export interface ControlPlaneServerEnvironment {
  readonly OPENAI_API_KEY?: string;
  readonly OPENAI_WEBHOOK_SECRET?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly SIXTYFOUR_API_KEY?: string;
  readonly AI_CONTROL_PLANE_HOST?: string;
  readonly HOST?: string;
  readonly PORT?: string;
}

export interface ControlPlaneServerOptions {
  readonly env?: ControlPlaneServerEnvironment;
  readonly host?: string;
  readonly port?: number;
  readonly serviceName?: string;
  readonly version?: string;
  readonly now?: () => Date;
}

export interface RuntimeCredentialState {
  readonly openaiApiKey: boolean;
  readonly supabaseUrl: boolean;
  readonly supabaseServiceRoleKey: boolean;
}

export interface ApiHealthPayload {
  readonly status: 'ok';
  readonly name: string;
  readonly service: string;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  readonly credentials: RuntimeCredentialState;
}

class RequestBodyError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolvePort(env: ControlPlaneServerEnvironment = process.env): number {
  const rawPort = env.PORT;
  if (rawPort === undefined || rawPort.trim() === '') return DEFAULT_PORT;
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) return DEFAULT_PORT;
  return port;
}

export function resolveHost(env: ControlPlaneServerEnvironment = process.env): string {
  return env.AI_CONTROL_PLANE_HOST?.trim() || env.HOST?.trim() || DEFAULT_HOST;
}

export function readServerConfig(env: ControlPlaneServerEnvironment = process.env): { host: string; port: number } {
  return { host: resolveHost(env), port: resolvePort(env) };
}

export function readCredentialState(env: ControlPlaneServerEnvironment = process.env): RuntimeCredentialState {
  return {
    openaiApiKey: hasValue(env.OPENAI_API_KEY),
    supabaseUrl: hasValue(env.SUPABASE_URL),
    supabaseServiceRoleKey: hasValue(env.SUPABASE_SERVICE_ROLE_KEY)
  };
}

export function createHealthPayload(options: ControlPlaneServerOptions = {}): ApiHealthPayload {
  const now = options.now ?? (() => new Date());
  return {
    status: 'ok',
    name: PACKAGE_NAME,
    service: options.serviceName ?? DEFAULT_SERVICE_NAME,
    version: options.version ?? PACKAGE_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: now().toISOString(),
    credentials: readCredentialState(options.env ?? process.env)
  };
}

export function getHealthPayload(env: ControlPlaneServerEnvironment = process.env, now: () => Date = () => new Date()): ApiHealthPayload {
  return createHealthPayload({ env, now });
}

export function createPackageInfoPayload(options: ControlPlaneServerOptions = {}) {
  return {
    name: PACKAGE_NAME,
    service: options.serviceName ?? DEFAULT_SERVICE_NAME,
    version: options.version ?? PACKAGE_VERSION,
    packageType: 'library' as const,
    endpoints: {
      health: '/health',
      ready: '/ready',
      package: '/api/package',
      verifyAcceptance: '/v1/verify-acceptance',
      openaiWebhook: '/webhooks/openai'
    }
  };
}

export function getPackagePayload() {
  return createPackageInfoPayload();
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload).toString(),
    'cache-control': 'no-store',
    ...headers
  });
  response.end(payload);
}

function methodAllowed(request: IncomingMessage, response: ServerResponse, allowedMethods: string[]): boolean {
  if (allowedMethods.includes(request.method ?? '')) return true;
  request.resume();
  writeJson(response, 405, { error: 'method_not_allowed', allowedMethods }, { allow: allowedMethods.join(', ') });
  return false;
}

function payloadTooLarge(): RequestBodyError {
  return new RequestBodyError(413, 'payload_too_large', `Request body must not exceed ${MAX_VERIFICATION_INPUT_BYTES} bytes`);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_VERIFICATION_INPUT_BYTES) {
    request.resume();
    return Promise.reject(payloadTooLarge());
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const rejectOnce = (error: RequestBodyError) => {
      if (settled) return;
      settled = true;
      request.resume();
      rejectPromise(error);
    };
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_VERIFICATION_INPUT_BYTES) {
        rejectOnce(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (settled) return;
      settled = true;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.trim().length === 0) resolvePromise(undefined);
        else resolvePromise(JSON.parse(text));
      } catch {
        rejectPromise(new RequestBodyError(400, 'invalid_json', 'Request body must contain valid JSON'));
      }
    });
    request.once('error', () => rejectOnce(new RequestBodyError(400, 'invalid_request', 'Unable to read request body')));
  });
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    throw new RequestBodyError(400, 'invalid_url', 'Request URL is invalid');
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: ControlPlaneServerOptions): Promise<void> {
  let path: string;
  try {
    path = requestPath(request);
  } catch (error) {
    request.resume();
    const bodyError = error as RequestBodyError;
    writeJson(response, bodyError.statusCode, { error: bodyError.code, message: bodyError.message });
    return;
  }

  if (path === '/health' || path === '/healthz' || path === '/ready') {
    if (!methodAllowed(request, response, ['GET', 'HEAD'])) return;
    request.resume();
    writeJson(response, 200, createHealthPayload(options));
    return;
  }

  if (path === '/' || path === '/api/package') {
    if (!methodAllowed(request, response, ['GET', 'HEAD'])) return;
    request.resume();
    writeJson(response, 200, createPackageInfoPayload(options));
    return;
  }

  if (path === '/webhooks/openai') {
    const env = options.env ?? process.env;
    await handleOpenAIWebhook(request, response, { secret: env.OPENAI_WEBHOOK_SECRET, now: options.now });
    return;
  }

  if (path === '/v1/verify-acceptance') {
    if (!methodAllowed(request, response, ['POST'])) return;
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      request.resume();
      writeJson(response, 415, { error: 'unsupported_media_type', message: 'Content-Type must be application/json' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      writeJson(response, 200, verifyAcceptanceInput(body));
    } catch (error) {
      if (error instanceof RequestBodyError) writeJson(response, error.statusCode, { error: error.code, message: error.message });
      else writeJson(response, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request' });
    }
    return;
  }

  request.resume();
  writeJson(response, 404, { error: 'not_found', path });
}

export function createControlPlaneRequestHandler(options: ControlPlaneServerOptions = {}): RequestListener {
  return (request, response) => {
    void handleRequest(request, response, options).catch(() => {
      if (!response.headersSent) writeJson(response, 500, { error: 'internal_error' });
      else response.destroy();
    });
  };
}

export function createControlPlaneServer(options: ControlPlaneServerOptions = {}): Server {
  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, createControlPlaneRequestHandler(options));
}

export function createControlPlaneHttpServer(options: ControlPlaneServerOptions = {}): Server {
  return createControlPlaneServer(options);
}

export async function startControlPlaneServer(options: ControlPlaneServerOptions = {}): Promise<Server> {
  const env = options.env ?? process.env;
  const host = options.host ?? readServerConfig(env).host;
  const port = options.port ?? readServerConfig(env).port;
  const server = createControlPlaneServer(options);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });
  return server;
}

export async function startControlPlaneHttpServer(options: ControlPlaneServerOptions = {}): Promise<Server> {
  return startControlPlaneServer(options);
}

export function startServer(options: ControlPlaneServerOptions = {}): Server {
  const server = createControlPlaneServer(options);
  const env = options.env ?? process.env;
  const host = options.host ?? readServerConfig(env).host;
  const port = options.port ?? readServerConfig(env).port;
  const shutdown = () => server.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.once('close', () => {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  });
  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(`Unable to start ai-control-plane server: ${error.code ?? 'listen_failed'}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const address = server.address();
    if (typeof address === 'object' && address !== null) {
      console.log(JSON.stringify({ event: 'listening', service: options.serviceName ?? DEFAULT_SERVICE_NAME, host: address.address, port: address.port }));
    }
  });
  return server;
}

export function isServerEntrypoint(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

if (isServerEntrypoint(import.meta.url)) {
  startServer();
}
