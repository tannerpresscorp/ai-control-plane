const state = {
  business: null,
  peerConnection: null,
  dataChannel: null,
  localStream: null
};

const elements = {
  start: document.querySelector('#start-call'),
  stop: document.querySelector('#stop-call'),
  status: document.querySelector('#session-status'),
  permissionNote: document.querySelector('#permission-note'),
  businessName: document.querySelector('#business-name'),
  businessDetails: document.querySelector('#business-details'),
  serviceFilter: document.querySelector('#service-filter'),
  availableTimes: document.querySelector('#available-times'),
  bookings: document.querySelector('#bookings'),
  bookingCount: document.querySelector('#booking-count'),
  transcript: document.querySelector('#transcript'),
  remoteAudio: document.querySelector('#remote-audio')
};

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options.headers
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? `Request failed: ${response.status}`);
  return json;
}

function setStatus(label, tone = '') {
  elements.status.textContent = label;
  elements.status.className = `status-pill ${tone}`.trim();
}

function addTranscript(role, text) {
  if (!text) return;
  const item = document.createElement('li');
  const speaker = document.createElement('strong');
  speaker.textContent = role;
  item.append(speaker, document.createTextNode(text));
  elements.transcript.prepend(item);
}

function renderState(nextState) {
  state.business = nextState.business;
  elements.businessName.textContent = nextState.business.name;
  elements.businessDetails.textContent = `${nextState.business.address} | ${nextState.business.phone} | ${nextState.business.timezone}`;

  if (elements.serviceFilter.options.length === 0) {
    for (const service of nextState.business.services) {
      const option = document.createElement('option');
      option.value = service.id;
      option.textContent = `${service.name} (${service.durationMinutes} min)`;
      elements.serviceFilter.append(option);
    }
  }

  renderAvailableTimes(nextState.availableTimes);
  renderBookings(nextState.bookings);
}

function renderAvailableTimes(slots) {
  elements.availableTimes.replaceChildren(...slots.map(slot => {
    const card = document.createElement('article');
    card.className = 'slot';
    card.innerHTML = `
      <time>${slot.date} | ${slot.time}-${slot.endTime}</time>
      <p>${slot.serviceName}</p>
      <p>${slot.staff}</p>
    `;
    return card;
  }));
}

function renderBookings(bookings) {
  elements.bookingCount.textContent = String(bookings.length);
  elements.bookings.replaceChildren(...bookings.map(booking => {
    const card = document.createElement('article');
    card.className = 'booking';
    card.innerHTML = `
      <time>${booking.date} | ${booking.time}</time>
      <h2>${booking.customerName}</h2>
      <p>${booking.serviceName} with ${booking.staff}</p>
      <p>${booking.customerPhone}</p>
    `;
    return card;
  }));
}

async function refreshState() {
  renderState(await requestJson('/api/state', { headers: {} }));
}

async function refreshAvailability() {
  const result = await requestJson('/api/availability', {
    method: 'POST',
    body: JSON.stringify({ serviceId: elements.serviceFilter.value })
  });
  renderAvailableTimes(result.availableTimes);
}

async function startVoiceSession() {
  try {
    elements.start.disabled = true;
    setStatus('Starting session', 'live');
    const session = await requestJson('/api/realtime-session', {
      method: 'POST',
      body: JSON.stringify({})
    });
    const ephemeralKey = session.client_secret?.value;
    if (!ephemeralKey) throw new Error('Realtime session did not include a client secret.');

    setStatus('Requesting mic', 'live');
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    elements.permissionNote.textContent = 'Microphone is connected. You can interrupt the assistant naturally while it is speaking.';

    state.peerConnection = new RTCPeerConnection();
    state.peerConnection.ontrack = event => {
      elements.remoteAudio.srcObject = event.streams[0];
    };
    for (const track of state.localStream.getTracks()) {
      state.peerConnection.addTrack(track, state.localStream);
    }

    state.dataChannel = state.peerConnection.createDataChannel('oai-events');
    state.dataChannel.addEventListener('open', () => {
      setStatus('Live', 'live');
      elements.stop.disabled = false;
      sendRealtimeEvent({
        type: 'response.create',
        response: {
          instructions: 'Greet the caller and ask what appointment they would like to book.'
        }
      });
    });
    state.dataChannel.addEventListener('message', event => handleRealtimeEvent(JSON.parse(event.data)));

    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model ?? 'gpt-live')}`, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        authorization: `Bearer ${ephemeralKey}`,
        'content-type': 'application/sdp'
      }
    });

    if (!sdpResponse.ok) throw new Error(await sdpResponse.text());
    await state.peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: await sdpResponse.text()
    });
  } catch (error) {
    setStatus('Error', 'error');
    addTranscript('System', error.message);
    await stopVoiceSession();
  }
}

function sendRealtimeEvent(event) {
  if (state.dataChannel?.readyState === 'open') {
    state.dataChannel.send(JSON.stringify(event));
  }
}

async function handleRealtimeEvent(event) {
  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    addTranscript('Caller', event.transcript);
  }

  if (event.type === 'response.audio_transcript.done') {
    addTranscript('Front Desk', event.transcript);
  }

  if (event.type === 'response.function_call_arguments.done') {
    await runToolCall(event);
  }
}

async function runToolCall(event) {
  const args = event.arguments ? JSON.parse(event.arguments) : {};
  let output;

  if (event.name === 'check_availability') {
    output = await requestJson('/api/availability', {
      method: 'POST',
      body: JSON.stringify(args)
    });
    renderAvailableTimes(output.availableTimes);
  } else if (event.name === 'prepare_booking') {
    output = await requestJson('/api/prepare-booking', {
      method: 'POST',
      body: JSON.stringify(args)
    });
  } else if (event.name === 'save_booking') {
    output = await requestJson('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(args)
    });
    renderState(output.state);
  } else if (event.name === 'end_session') {
    output = { ended: true };
    window.setTimeout(() => stopVoiceSession(), 800);
  } else {
    output = { error: `Unknown tool ${event.name}` };
  }

  sendRealtimeEvent({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: event.call_id,
      output: JSON.stringify(output)
    }
  });
  sendRealtimeEvent({ type: 'response.create' });
}

async function stopVoiceSession() {
  state.dataChannel?.close();
  state.peerConnection?.close();
  for (const track of state.localStream?.getTracks() ?? []) track.stop();
  state.dataChannel = null;
  state.peerConnection = null;
  state.localStream = null;
  elements.remoteAudio.srcObject = null;
  elements.start.disabled = false;
  elements.stop.disabled = true;
  if (!elements.status.classList.contains('error')) setStatus('Idle');
}

elements.start.addEventListener('click', startVoiceSession);
elements.stop.addEventListener('click', stopVoiceSession);
elements.serviceFilter.addEventListener('change', refreshAvailability);

refreshState().catch(error => {
  setStatus('Error', 'error');
  addTranscript('System', error.message);
});
