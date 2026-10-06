import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_SERVICE_NAME = '@tannerpress/ai-control-plane';
const DEFAULT_SERVICE_VERSION = '0.1.0';
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';

export interface ApiServerOptions {
  readonly name?: string;
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
  return env.HOST?.trim() || DEFAULT_HOST;
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
    service: options.name ?? DEFAULT_SERVICE_NAME,
    version: options.version ?? process.env.npm_package_version ?? DEFAULT_SERVICE_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: now().toISOString(),
    credentials: readCredentialState(options.env ?? process.env),
  };
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function requestPath(request: IncomingMessage): string {
  const url = new URL(request.url ?? '/', 'http://localhost');
  return url.pathname;
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeJson(response, 405, {
        error: 'method_not_allowed',
        allowedMethods: ['GET', 'HEAD'],
      });
      return;
    }

    const path = requestPath(request);

    if (path === '/health' || path === '/ready') {
      writeJson(response, 200, createHealthPayload(options));
      return;
    }

    if (path === '/') {
      writeJson(response, 200, {
        service: options.name ?? DEFAULT_SERVICE_NAME,
        version: options.version ?? process.env.npm_package_version ?? DEFAULT_SERVICE_VERSION,
        endpoints: {
          health: '/health',
          ready: '/ready',
        },
      });
      return;
    }

    writeJson(response, 404, {
      error: 'not_found',
      path,
    });
  });
}

export function startServer(options: ApiServerOptions = {}): Server {
  const env = options.env ?? process.env;
  const host = resolveHost(env);
  const port = resolvePort(env);
  const server = createApiServer(options);

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
