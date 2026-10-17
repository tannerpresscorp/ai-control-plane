import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { test } from 'node:test';
import { createControlPlaneServer } from '../dist/server.js';

function signWebhook(secret, webhookId, timestamp, body) {
  return createHmac('sha256', secret)
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest('base64');
}

function httpRequest(baseUrl, { method = 'POST', path = '/webhooks/openai', body = '', headers = {} } = {}) {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body).toString(),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data.length ? JSON.parse(data) : undefined
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function withServer(options, fn) {
  const server = createControlPlaneServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('OpenAI webhook accepts a valid signed event', async () => {
  const secret = 'whsec_test_secret';
  const webhookId = 'wh_123';
  const timestamp = '1792224000';
  const body = JSON.stringify({ id: 'evt_123', type: 'response.completed', data: { id: 'resp_123' } });
  const signature = signWebhook(secret, webhookId, timestamp, body);

  await withServer({ env: { OPENAI_WEBHOOK_SECRET: secret }, now: () => new Date('2026-10-17T09:20:00.000Z') }, async (baseUrl) => {
    const result = await httpRequest(baseUrl, {
      body,
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`
      }
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { received: true, eventId: 'evt_123', eventType: 'response.completed' });
  });
});

test('OpenAI webhook rejects an invalid signature', async () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_123', type: 'response.completed' });

  await withServer({ env: { OPENAI_WEBHOOK_SECRET: secret }, now: () => new Date('2026-10-17T09:20:00.000Z') }, async (baseUrl) => {
    const result = await httpRequest(baseUrl, {
      body,
      headers: {
        'webhook-id': 'wh_123',
        'webhook-timestamp': '1792224000',
        'webhook-signature': 'v1,invalid'
      }
    });

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'invalid_webhook_signature');
  });
});

test('OpenAI webhook fails closed when the signing secret is absent', async () => {
  const body = JSON.stringify({ id: 'evt_123', type: 'response.completed' });

  await withServer({ env: {}, now: () => new Date('2026-10-17T09:20:00.000Z') }, async (baseUrl) => {
    const result = await httpRequest(baseUrl, { body });
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error, 'webhook_not_configured');
  });
});

test('OpenAI webhook rejects stale timestamps', async () => {
  const secret = 'whsec_test_secret';
  const webhookId = 'wh_123';
  const timestamp = '1792223400';
  const body = JSON.stringify({ id: 'evt_123', type: 'response.completed' });
  const signature = signWebhook(secret, webhookId, timestamp, body);

  await withServer({ env: { OPENAI_WEBHOOK_SECRET: secret }, now: () => new Date('2026-10-17T09:20:00.000Z') }, async (baseUrl) => {
    const result = await httpRequest(baseUrl, {
      body,
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`
      }
    });
    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'invalid_webhook_signature');
  });
});

test('OpenAI webhook rejects malformed JSON after successful signature verification', async () => {
  const secret = 'whsec_test_secret';
  const webhookId = 'wh_123';
  const timestamp = '1792224000';
  const body = '{';
  const signature = signWebhook(secret, webhookId, timestamp, body);

  await withServer({ env: { OPENAI_WEBHOOK_SECRET: secret }, now: () => new Date('2026-10-17T09:20:00.000Z') }, async (baseUrl) => {
    const result = await httpRequest(baseUrl, {
      body,
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`
      }
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, 'invalid_json');
  });
});
