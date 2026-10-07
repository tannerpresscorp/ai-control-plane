import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_ROOT = resolve(HERE, 'public');
const REPO_ROOT = resolve(HERE, '..');
const DIST_ROOT = resolve(REPO_ROOT, 'dist');
const REALTIME_MODEL = 'gpt-realtime-2.1';
const MAX_BODY_BYTES = 32 * 1024;

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8']
]);

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(text);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('JSON body must be an object.');
  }
  return parsed;
}

function safeFilePath(root, pathname) {
  const relative = normalize(pathname).replace(/^[/\\]+/, '');
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}/`) && !candidate.startsWith(`${root}\\`)) {
    return null;
  }
  return candidate;
}

async function serveFile(res, root, pathname) {
  const filePath = safeFilePath(root, pathname);
  if (!filePath) return false;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;

    res.writeHead(200, {
      'content-type': CONTENT_TYPES.get(extname(filePath)) ?? 'application/octet-stream',
      'content-length': info.size
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function createRealtimeSecret(openAIKey, fetchImpl) {
  if (!openAIKey) {
    return {
      ok: false,
      status: 500,
      body: { error: 'OPENAI_API_KEY is not configured on the server.' }
    };
  }

  const upstream = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAIKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 60 },
      session: { type: 'realtime', model: REALTIME_MODEL }
    })
  });

  if (!upstream.ok) {
    return {
      ok: false,
      status: 502,
      body: { error: 'OpenAI Realtime client-secret request failed.' }
    };
  }

  const data = await upstream.json();
  if (typeof data?.value !== 'string' || data.value.length === 0) {
    return {
      ok: false,
      status: 502,
      body: { error: 'OpenAI Realtime response did not include a client secret.' }
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      client_secret: data.value,
      ...(typeof data.expires_at === 'number' ? { expires_at: data.expires_at } : {})
    }
  };
}

function placeholderSupportContext(question) {
  return {
    ok: true,
    placeholder: true,
    product: 'AI Control Plane',
    question,
    message:
      'PLACEHOLDER: No production support knowledge or account/ticket backend is connected yet. Use repository documentation and application behavior as the current support source.'
  };
}

function placeholderSupportRequest(summary) {
  return {
    ok: true,
    placeholder: true,
    request_id: `PLACEHOLDER-${Date.now()}`,
    summary,
    message:
      'PLACEHOLDER: This follow-up request is not persisted. Replace this route with the real support or ticket service before production use.'
  };
}

export function createSupportServer({
  openAIKey = process.env.OPENAI_API_KEY,
  fetchImpl = fetch
} = {}) {
  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');

    try {
      if (method === 'POST' && url.pathname === '/api/realtime/session') {
        const result = await createRealtimeSecret(openAIKey, fetchImpl);
        sendJson(res, result.status, result.body);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/support/context') {
        const body = await readJson(req);
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question) {
          sendJson(res, 400, { error: 'question is required.' });
          return;
        }
        sendJson(res, 200, placeholderSupportContext(question));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/support/request') {
        const body = await readJson(req);
        const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
        if (!summary) {
          sendJson(res, 400, { error: 'summary is required.' });
          return;
        }
        sendJson(res, 200, placeholderSupportRequest(summary));
        return;
      }

      if (method === 'GET' || method === 'HEAD') {
        const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
        if (pathname.startsWith('/dist/')) {
          if (await serveFile(res, DIST_ROOT, pathname.slice('/dist/'.length))) return;
        } else if (await serveFile(res, PUBLIC_ROOT, pathname)) {
          return;
        }
      }

      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error.';
      sendJson(res, 400, { error: message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createSupportServer();
  server.listen(port, () => {
    console.log(`Realtime support app: http://localhost:${port}`);
  });
}
