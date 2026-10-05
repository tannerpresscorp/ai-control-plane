import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, 'public');
const port = Number(process.env.FRONT_DESK_PORT ?? process.env.PORT ?? 4173);
const openaiApiKey = process.env.OPENAI_API_KEY;
const realtimeModel = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-live';
const responsesModel = process.env.OPENAI_RESPONSES_MODEL ?? 'gpt-4.1-mini';

const business = {
  name: 'Harbor & Pine Wellness',
  timezone: 'America/Chicago',
  address: '214 Cedar Street, Chicago, IL',
  phone: '(312) 555-0198',
  services: [
    { id: 'consult', name: 'New client consultation', durationMinutes: 30 },
    { id: 'therapy', name: 'Massage therapy', durationMinutes: 60 },
    { id: 'followup', name: 'Follow-up visit', durationMinutes: 45 }
  ],
  staff: ['Maya', 'Jordan']
};

const bookings = [
  {
    id: 'seed-1',
    customerName: 'Avery Stone',
    customerPhone: '(312) 555-0144',
    serviceId: 'therapy',
    staff: 'Maya',
    date: '2026-10-05',
    time: '10:00',
    durationMinutes: 60,
    notes: 'Prefers quiet room.',
    confirmedAt: new Date().toISOString()
  },
  {
    id: 'seed-2',
    customerName: 'Nina Patel',
    customerPhone: '(312) 555-0110',
    serviceId: 'consult',
    staff: 'Jordan',
    date: '2026-10-05',
    time: '14:30',
    durationMinutes: 30,
    notes: '',
    confirmedAt: new Date().toISOString()
  }
];

const workdayHours = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function addMinutes(time, minutes) {
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function overlaps(aStart, aDuration, bStart, bDuration) {
  const toMinutes = value => {
    const [hours, mins] = value.split(':').map(Number);
    return hours * 60 + mins;
  };
  const a0 = toMinutes(aStart);
  const a1 = a0 + aDuration;
  const b0 = toMinutes(bStart);
  const b1 = b0 + bDuration;
  return a0 < b1 && b0 < a1;
}

function getService(serviceId) {
  return business.services.find(service => service.id === serviceId) ?? business.services[0];
}

function nextDemoDates(count = 5) {
  const dates = [];
  const start = new Date('2026-10-05T12:00:00-05:00');
  for (let offset = 0; dates.length < count; offset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function availabilityFor({ serviceId = 'consult', preferredDate, staff }) {
  const service = getService(serviceId);
  const dates = preferredDate ? [preferredDate] : nextDemoDates();
  return dates.flatMap(date => {
    const staffList = staff ? [staff] : business.staff;
    return staffList.flatMap(staffMember => {
      return workdayHours
        .filter(time => {
          const blocked = bookings.some(booking => booking.date === date
            && booking.staff === staffMember
            && overlaps(time, service.durationMinutes, booking.time, booking.durationMinutes));
          return !blocked && addMinutes(time, service.durationMinutes) <= '17:00';
        })
        .slice(0, 6)
        .map(time => ({
          date,
          time,
          endTime: addMinutes(time, service.durationMinutes),
          staff: staffMember,
          serviceId: service.id,
          serviceName: service.name,
          durationMinutes: service.durationMinutes
        }));
    });
  }).slice(0, 12);
}

function bookingParametersSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      customerName: { type: 'string' },
      customerPhone: { type: 'string' },
      serviceId: { type: 'string', enum: business.services.map(service => service.id) },
      staff: { type: 'string', enum: business.staff },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      time: { type: 'string', description: 'HH:MM in 24-hour time' },
      notes: { type: 'string' }
    },
    required: ['customerName', 'customerPhone', 'serviceId', 'staff', 'date', 'time', 'notes']
  };
}

function localBookingSummary(input, warning) {
  const requiredFields = ['customerName', 'customerPhone', 'serviceId', 'staff', 'date', 'time'];
  const missingFields = requiredFields.filter(field => typeof input[field] !== 'string' || input[field].trim() === '');
  const service = getService(input.serviceId);
  return {
    summary: `${input.customerName ?? 'The caller'} for ${service.name} on ${input.date ?? 'the requested date'} at ${input.time ?? 'the requested time'} with ${input.staff ?? 'the requested provider'}.`,
    missingFields,
    ...(warning ? { warning } : {})
  };
}

async function askResponsesForBookingSummary(input) {
  if (!openaiApiKey) {
    return localBookingSummary(input);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${openaiApiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: responsesModel,
        input: [
          {
            role: 'system',
            content: 'You help a front desk verify appointment booking details. Return compact JSON only.'
          },
          {
            role: 'user',
            content: JSON.stringify({ business, requestedBooking: input })
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'booking_summary',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'string' },
                missingFields: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['summary', 'missingFields']
            },
            strict: true
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Responses API failed: ${response.status} ${detail}`);
    }

    const json = await response.json();
    const text = json.output_text ?? json.output?.flatMap(item => item.content ?? []).find(part => part.type === 'output_text')?.text;
    return JSON.parse(text);
  } catch (error) {
    return localBookingSummary(input, `Responses API unavailable for this local demo: ${error.message}`);
  }
}

async function createRealtimeSession() {
  if (!openaiApiKey) {
    throw new Error('Set OPENAI_API_KEY on the server before starting a voice session.');
  }

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${openaiApiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: realtimeModel,
      voice: 'alloy',
      input_audio_transcription: {
        model: 'gpt-4o-mini-transcribe'
      },
      instructions: [
        `You are Front Desk for ${business.name}. Help callers book appointments by voice.`,
        'Keep the conversation natural and concise. Let the caller interrupt or change preferences at any time.',
        'Use check_availability before offering exact appointment times.',
        'Use prepare_booking when the caller has chosen a slot so the backend can verify details.',
        'Before saving, speak a clear final confirmation including customer name, service, date, time, staff, and phone.',
        'Only call save_booking after the caller explicitly confirms.',
        'If the caller says they are finished, say goodbye and call end_session.'
      ].join('\n'),
      tools: [
        {
          type: 'function',
          name: 'check_availability',
          description: 'Find available demo appointment slots.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              serviceId: { type: 'string', enum: business.services.map(service => service.id) },
              preferredDate: { type: 'string', description: 'YYYY-MM-DD, if the caller has a date preference.' },
              staff: { type: 'string', enum: business.staff }
            },
            required: ['serviceId']
          }
        },
        {
          type: 'function',
          name: 'prepare_booking',
          description: 'Verify details and build a spoken confirmation before saving.',
          parameters: bookingParametersSchema()
        },
        {
          type: 'function',
          name: 'save_booking',
          description: 'Save the booking after explicit caller confirmation.',
          parameters: bookingParametersSchema()
        },
        {
          type: 'function',
          name: 'end_session',
          description: 'Close the voice session when the caller is done.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: []
          }
        }
      ],
      tool_choice: 'auto',
      turn_detection: {
        type: 'server_vad',
        interrupt_response: true
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Realtime session failed: ${response.status} ${detail}`);
  }

  return response.json();
}

function publicState() {
  return {
    business,
    bookings: bookings.map(booking => ({
      ...booking,
      serviceName: getService(booking.serviceId).name
    })),
    availableTimes: availabilityFor({})
  };
}

async function routeApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime-session') {
    try {
      sendJson(res, 200, await createRealtimeSession());
    } catch (error) {
      sendJson(res, openaiApiKey ? 500 : 503, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/availability') {
    const body = await readJson(req);
    sendJson(res, 200, { availableTimes: availabilityFor(body) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/prepare-booking') {
    try {
      const body = await readJson(req);
      const available = availabilityFor(body).some(slot => slot.date === body.date && slot.time === body.time && slot.staff === body.staff);
      const summary = await askResponsesForBookingSummary(body);
      sendJson(res, 200, { available, ...summary });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bookings') {
    try {
      const body = await readJson(req);
      const summary = await askResponsesForBookingSummary(body);
      if (summary.missingFields.length > 0) {
        sendJson(res, 400, { error: `Missing ${summary.missingFields.join(', ')}`, ...summary });
        return;
      }

      const available = availabilityFor(body).some(slot => slot.date === body.date && slot.time === body.time && slot.staff === body.staff);
      if (!available) {
        sendJson(res, 409, { error: 'That appointment time is no longer available.', availableTimes: availabilityFor(body) });
        return;
      }

      const service = getService(body.serviceId);
      const booking = {
        id: crypto.randomUUID(),
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        serviceId: service.id,
        staff: body.staff,
        date: body.date,
        time: body.time,
        durationMinutes: service.durationMinutes,
        notes: body.notes ?? '',
        confirmedAt: new Date().toISOString()
      };
      bookings.push(booking);
      sendJson(res, 201, { booking: { ...booking, serviceName: service.name }, state: publicState() });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

async function routeStatic(req, res, pathname) {
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const absolutePath = join(publicDir, safePath);
  if (!absolutePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(absolutePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8'
    };
    res.writeHead(200, { 'content-type': types[extname(absolutePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    await routeApi(req, res, url.pathname);
    return;
  }
  await routeStatic(req, res, url.pathname);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Set FRONT_DESK_PORT to another port.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, () => {
  console.log(`Front Desk running at http://localhost:${port}`);
});
