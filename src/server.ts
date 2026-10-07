import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { PACKAGE_NAME, PACKAGE_VERSION } from './package-metadata.js';
import { MAX_VERIFICATION_INPUT_BYTES, verifyAcceptanceInput } from './verification-input.js';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SERVICE_NAME = 'ai-control-plane-api';

export interface ApiServerOptions {
  readonly name?: string;
  readonly serviceName?: string;
  readonly version?: string;
  readonly env?: NodeJS.ProcessEnv;
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

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const rawPort = env.PORT;
  if (rawPort === undefined || rawPort.trim() === '') {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_CONTROL_PLANE_HOST?.trim() || env.HOST?.trim() || DEFAULT_HOST;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): { host: string; port: number } {
  let port = DEFAULT_PORT;
  try {
    port = resolvePort(env);
  } catch {
    // The service's environment contract falls back to the documented default.
  }
  return { host: resolveHost(env), port };
}

export function readCredentialState(env: NodeJS.ProcessEnv = process.env): RuntimeCredentialState {
  return {
    openaiApiKey: Boolean(env.OPENAI_API_KEY),
    supabaseUrl: Boolean(env.SUPABASE_URL),
    supabaseServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

export function createHealthPayload(options: ApiServerOptions = {}): ApiHealthPayload {
  const now = options.now ?? (() => new Date());
  return {
    status: 'ok',
    name: options.name ?? PACKAGE_NAME,
    service: options.serviceName ?? DEFAULT_SERVICE_NAME,
    version: options.version ?? PACKAGE_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: now().toISOString(),
    credentials: readCredentialState(options.env ?? process.env),
  };
}

export function createPackageInfoPayload(options: ApiServerOptions = {}) {
  return {
    name: options.name ?? PACKAGE_NAME,
    version: options.version ?? PACKAGE_VERSION,
    service: options.serviceName ?? DEFAULT_SERVICE_NAME,
    packageType: 'library' as const,
    endpoints: {
      health: '/health',
      ready: '/ready',
      package: '/api/package',
      verifyAcceptance: '/v1/verify-acceptance',
    },
  };
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(payload);
}

function requestPath(request: IncomingMessage): string {
  const url = new URL(request.url ?? '/', 'http://localhost');
  return url.pathname;
}

class RequestBodyError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function payloadTooLarge(): RequestBodyError {
  return new RequestBodyError(413, 'payload_too_large', `Request body must not exceed ${MAX_VERIFICATION_INPUT_BYTES} bytes`);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (Number(request.headers['content-length']) > MAX_VERIFICATION_INPUT_BYTES) {
    request.resume();
    return Promise.reject(payloadTooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (error: RequestBodyError) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    };
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_VERIFICATION_INPUT_BYTES) {
        fail(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (settled) return;
      settled = true;
      try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(json));
      } catch {
        reject(new RequestBodyError(400, 'invalid_json', 'Request body must contain valid JSON'));
      }
    });
    request.once('aborted', () => fail(new RequestBodyError(400, 'invalid_request', 'Request body was interrupted')));
    request.once('error', () => fail(new RequestBodyError(400, 'invalid_request', 'Unable to read request body')));
  });
}

function methodAllowed(request: IncomingMessage, response: ServerResponse, allowedMethods: string[]): boolean {
  if (allowedMethods.includes(request.method ?? '')) return true;
  request.resume();
  writeJson(response, 405, { error: 'method_not_allowed', allowedMethods }, { allow: allowedMethods.join(', ') });
  return false;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: ApiServerOptions): Promise<void> {
  let path: string;
  try {
    path = requestPath(request);
  } catch {
    request.resume();
    writeJson(response, 400, { error: 'invalid_url' });
    return;
  }

  if (path === '/v1/verify-acceptance') {
    if (!methodAllowed(request, response, ['POST'])) return;
    const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      request.resume();
      writeJson(response, 415, { error: 'unsupported_media_type', message: 'Content-Type must be application/json' });
      return;
    }
    let value: unknown;
    try {
      value = await readJsonBody(request);
    } catch (error) {
      if (!(error instanceof RequestBodyError)) throw error;
      if (!response.destroyed) writeJson(response, error.statusCode, { error: error.code, message: error.message });
      return;
    }
    try {
      writeJson(response, 200, verifyAcceptanceInput(value));
    } catch (error) {
      writeJson(response, 400, { error: 'invalid_request', message: (error as Error).message });
    }
    return;
  }

  if (path === '/api/package') {
    if (!methodAllowed(request, response, ['GET', 'HEAD'])) return;
    request.resume();
    writeJson(response, 200, createPackageInfoPayload(options));
    return;
  }

  if (path === '/health' || path === '/ready' || path === '/') {
    if (!methodAllowed(request, response, ['GET', 'HEAD'])) return;
    request.resume();
    if (path !== '/') {
      writeJson(response, 200, createHealthPayload(options));
      return;
    }
    writeJson(response, 200, {
      name: options.name ?? PACKAGE_NAME,
      service: options.serviceName ?? DEFAULT_SERVICE_NAME,
      version: options.version ?? PACKAGE_VERSION,
      endpoints: { health: '/health', ready: '/ready', package: '/api/package', verifyAcceptance: '/v1/verify-acceptance' },
    });
    return;
  }

  request.resume();
  writeJson(response, 404, { error: 'not_found', path });
}

/** Reusable Node handler for an HTTP server or a serverless deployment adapter. */
export function createControlPlaneRequestHandler(options: ApiServerOptions = {}): RequestListener {
  return (request, response) => {
    request.on('error', () => { if (!response.writableEnded) response.destroy(); });
    void handleRequest(request, response, options).catch(() => {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else writeJson(response, 500, { error: 'internal_error' });
    });
  };
}

export function createControlPlaneServer(options: ApiServerOptions = {}): Server {
  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, createControlPlaneRequestHandler(options));
}

/** Compatibility alias for existing library consumers. */
export function createApiServer(options: ApiServerOptions = {}): Server {
  return createControlPlaneServer(options);
}

export function startServer(options: ApiServerOptions = {}): Server {
  const env = options.env ?? process.env;
  const { host, port } = readServerConfig(env);
  const server = createApiServer(options);

  const shutdown = () => {
    const forceClose = setTimeout(() => server.closeAllConnections(), 5_000);
    forceClose.unref();
    server.close(() => clearTimeout(forceClose));
  };
  const cleanup = () => {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.once('close', cleanup);
  server.once('error', (error: NodeJS.ErrnoException) => {
    cleanup();
    console.error(`Unable to start ai-control-plane server: ${error.code ?? 'listen_failed'}`);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const address = server.address();
    const renderedAddress = typeof address === 'object' && address !== null
      ? `${address.address}:${address.port}`
      : String(address);
    console.log(`ai-control-plane listening on ${renderedAddress}`);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
