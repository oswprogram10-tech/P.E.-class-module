/* Local-first QR mission state machine. QR payloads contain only an opaque mission UUID. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QRMissions = api;
})(globalThis, function (root) {
  'use strict';

  const VERSION = 1;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MAX_MISSIONS = 200;
  const MAX_SESSIONS = 1000;
  const MAX_RESPONSES = 20000;
  const MAX_ACTIVITIES = 100;
  const fail = message => { throw new Error(message); };
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const string = (value, max, field) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Invalid ${field}.`);
    return value.trim();
  };
  const optionalString = (value, max, field) => value == null ? undefined : string(value, max, field);
  const idString = (value, field) => {
    if (typeof value !== 'string' || !UUID.test(value)) fail(`Invalid ${field}.`);
    return value.toLowerCase();
  };
  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID().toLowerCase();
    let cryptoApi = root.crypto;
    if (!cryptoApi && typeof require === 'function') {
      try { cryptoApi = require('node:crypto').webcrypto; } catch (_) { /* unavailable */ }
    }
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') fail('Secure random IDs are unavailable.');
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function newId(options) {
    const value = options && options.idFactory ? options.idFactory() : uuid();
    return idString(value, 'generated ID');
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function createState() { return { version: VERSION, missions: [], sessions: [], responses: [] }; }
  function checkState(state) {
    if (!isObject(state) || state.version !== VERSION || !Array.isArray(state.missions) || !Array.isArray(state.sessions) || !Array.isArray(state.responses)) fail('Invalid QR mission state.');
    if (state.missions.length > MAX_MISSIONS || state.sessions.length > MAX_SESSIONS || state.responses.length > MAX_RESPONSES) fail('QR mission state is full.');
    const unique = (items, key) => {
      const seen = new Set();
      for (const item of items) {
        if (!isObject(item) || typeof item[key] !== 'string' || seen.has(item[key])) fail('Invalid or duplicate QR mission record.');
        seen.add(item[key]);
      }
    };
    unique(state.missions, 'id'); unique(state.sessions, 'id'); unique(state.responses, 'id');
    return state;
  }
  function cleanQuiz(input) {
    if (input == null) return undefined;
    if (!isObject(input)) fail('Invalid quiz.');
    const prompt = string(input.prompt, 1000, 'quiz prompt');
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 12) fail('Invalid quiz options.');
    const options = input.options.map(option => {
      if (!isObject(option)) fail('Invalid quiz option.');
      return { id: string(option.id, 80, 'quiz option ID'), text: string(option.text, 500, 'quiz option text') };
    });
    if (new Set(options.map(option => option.id)).size !== options.length) fail('Duplicate quiz option ID.');
    const correctOptionId = input.correctOptionId == null ? undefined : string(input.correctOptionId, 80, 'correct option ID');
    if (correctOptionId && !options.some(option => option.id === correctOptionId)) fail('Correct quiz option is missing.');
    return { prompt, options, ...(correctOptionId ? { correctOptionId } : {}) };
  }
  function cleanActivity(input, options) {
    if (!isObject(input) || !['station', 'group'].includes(input.kind)) fail('Invalid activity.');
    const activity = {
      id: optionalString(input.id, 80, 'activity ID') || newId(options),
      kind: input.kind,
      title: string(input.title, 160, 'activity title'),
      instructions: string(input.instructions, 3000, 'activity instructions')
    };
    if (input.kind === 'group') activity.groupId = string(input.groupId, 80, 'group ID');
    else if (input.groupId != null) fail('Station activities cannot have a group ID.');
    if (input.criteria != null) activity.criteria = string(input.criteria, 1500, 'criteria');
    const quiz = cleanQuiz(input.quiz);
    if (quiz) activity.quiz = quiz;
    return activity;
  }
  function createMission(state, definition, options = {}) {
    checkState(state);
    if (!isObject(definition)) fail('Invalid mission definition.');
    if (state.missions.length >= MAX_MISSIONS) fail('QR mission state is full.');
    const classId = string(definition.classId, 120, 'class context');
    const title = string(definition.title, 160, 'mission title');
    if (!Array.isArray(definition.activities) || !definition.activities.length || definition.activities.length > MAX_ACTIVITIES) fail('A mission needs 1 to 100 ordered activities.');
    const activities = definition.activities.map(activity => cleanActivity(activity, options));
    if (new Set(activities.map(activity => activity.id)).size !== activities.length) fail('Duplicate activity ID.');
    const mission = { id: newId(options), classId, title, activities, createdAt: Number.isFinite(options.now) ? options.now : Date.now() };
    if (state.missions.some(item => item.id === mission.id)) fail('Duplicate generated mission ID.');
    state.missions.push(mission);
    return { mission: clone(mission), qrPayload: mission.id };
  }
  function getMission(state, missionId, classId) {
    checkState(state);
    idString(missionId, 'QR payload');
    const context = string(classId, 120, 'class context');
    const mission = state.missions.find(item => item.id.toLowerCase() === missionId.toLowerCase());
    if (!mission || mission.classId !== context) fail('QR mission or class context was not found.');
    return mission;
  }
  function findSession(state, sessionId) {
    const id = idString(sessionId, 'session ID');
    const session = state.sessions.find(item => item.id === id);
    if (!session) fail('QR mission session was not found.');
    return session;
  }
  function publicActivity(activity) {
    const value = { id: activity.id, kind: activity.kind, title: activity.title, instructions: activity.instructions };
    if (activity.groupId) value.groupId = activity.groupId;
    if (activity.criteria) value.criteria = activity.criteria;
    if (activity.quiz) value.quiz = { prompt: activity.quiz.prompt, options: clone(activity.quiz.options) };
    return value;
  }
  function status(state, session) {
    const mission = state.missions.find(item => item.id === session.missionId);
    if (!mission) fail('QR mission session was not found.');
    return {
      sessionId: session.id,
      missionId: mission.id,
      phase: session.phase,
      activityIndex: session.activityIndex,
      completed: session.phase === 'completed',
      ...(session.phase === 'completed' ? {} : { activity: publicActivity(mission.activities[session.activityIndex]) })
    };
  }
  function scan(state, qrPayload, classId, sessionId, options = {}) {
    const mission = getMission(state, qrPayload, classId);
    let session;
    if (sessionId == null) {
      if (state.sessions.length >= MAX_SESSIONS) fail('QR mission state is full.');
      session = { id: newId(options), missionId: mission.id, classId: mission.classId, activityIndex: 0, phase: 'active', run: 1, updatedAt: Number.isFinite(options.now) ? options.now : Date.now() };
      state.sessions.push(session);
    } else {
      session = findSession(state, sessionId);
      if (session.missionId !== mission.id || session.classId !== mission.classId) fail('QR mission session does not match this mission and class.');
      if (session.phase === 'paused') fail('Resume the QR mission before scanning.');
    }
    return status(state, session);
  }
  function respond(state, input, options = {}) {
    checkState(state);
    if (!isObject(input)) fail('Invalid activity response.');
    const responseId = idString(input.responseId, 'response ID');
    const session = findSession(state, input.sessionId);
    const mission = getMission(state, input.missionId, input.classId);
    if (session.missionId !== mission.id || session.classId !== mission.classId) fail('Response does not match this mission and class.');
    const activityId = string(input.activityId, 80, 'activity ID');
    const activity = mission.activities[session.activityIndex];
    const responseBody = { sessionId: session.id, missionId: mission.id, classId: mission.classId, run: session.run, activityId, ...(input.groupId == null ? {} : { groupId: string(input.groupId, 80, 'group ID') }), ...(input.answerOptionId == null ? {} : { answerOptionId: string(input.answerOptionId, 80, 'answer option ID') }), completed: input.completed === true };
    const duplicate = state.responses.find(item => item.id === responseId);
    if (duplicate) {
      if (JSON.stringify(duplicate.body) !== JSON.stringify(responseBody)) fail('Response ID was already used for a different response.');
      return { response: clone(duplicate), status: status(state, session), duplicate: true };
    }
    if (!activity || activity.id !== activityId) fail('Activity response is out of order.');
    if (session.phase !== 'active') fail('QR mission is not active.');
    if (responseBody.groupId !== activity.groupId) fail('Activity group does not match.');
    if (input.completed !== true) fail('Activity must be marked complete.');
    if (activity.quiz) {
      if (!activity.quiz.options.some(option => option.id === responseBody.answerOptionId)) fail('Select a valid quiz option.');
      if (!responseBody.answerOptionId) fail('Quiz response is required.');
    } else if (responseBody.answerOptionId) fail('This activity has no quiz.');
    if (state.responses.length >= MAX_RESPONSES) fail('QR mission response store is full.');
    const correct = activity.quiz?.correctOptionId ? responseBody.answerOptionId === activity.quiz.correctOptionId : undefined;
    const response = { id: responseId, body: responseBody, ...(correct === undefined ? {} : { correct }), createdAt: Number.isFinite(options.now) ? options.now : Date.now() };
    state.responses.push(response);
    session.activityIndex += 1;
    session.phase = session.activityIndex >= mission.activities.length ? 'completed' : 'active';
    session.updatedAt = Number.isFinite(options.now) ? options.now : Date.now();
    return { response: clone(response), status: status(state, session), duplicate: false };
  }
  function pause(state, sessionId, options = {}) {
    checkState(state); const session = findSession(state, sessionId);
    if (session.phase === 'active') session.phase = 'paused';
    session.updatedAt = Number.isFinite(options.now) ? options.now : Date.now();
    return status(state, session);
  }
  function resume(state, sessionId, options = {}) {
    checkState(state); const session = findSession(state, sessionId);
    if (session.phase === 'paused') session.phase = session.activityIndex >= state.missions.find(item => item.id === session.missionId).activities.length ? 'completed' : 'active';
    session.updatedAt = Number.isFinite(options.now) ? options.now : Date.now();
    return status(state, session);
  }
  function restart(state, sessionId, options = {}) {
    checkState(state); const session = findSession(state, sessionId);
    session.run += 1; session.activityIndex = 0; session.phase = 'active';
    session.updatedAt = Number.isFinite(options.now) ? options.now : Date.now();
    return status(state, session);
  }
  function serialize(state) {
    checkState(state);
    // Reparse the JSON result on import to guarantee a data-only, JSON-safe persistence boundary.
    return JSON.stringify({ version: VERSION, missions: state.missions, sessions: state.sessions, responses: state.responses });
  }
  function deserialize(serialized) {
    if (typeof serialized !== 'string' || serialized.length > 8_000_000) fail('Invalid QR mission serialization.');
    let state; try { state = JSON.parse(serialized); } catch (_) { fail('Invalid QR mission serialization.'); }
    checkState(state);
    // Rebuild only recognized fields so prototype-bearing or unexpected records cannot cross the boundary.
    const clean = createState();
    for (const source of state.missions) {
      const mission = { id: idString(source.id, 'mission ID'), classId: string(source.classId, 120, 'class context'), title: string(source.title, 160, 'mission title'), createdAt: source.createdAt, activities: source.activities?.map(activity => cleanActivity(activity, { idFactory: () => activity.id })) };
      if (!Number.isFinite(mission.createdAt) || !Array.isArray(mission.activities) || mission.activities.length < 1 || mission.activities.length > MAX_ACTIVITIES) fail('Invalid serialized mission.');
      clean.missions.push(mission);
    }
    for (const source of state.sessions) {
      const mission = clean.missions.find(item => item.id === source.missionId);
      if (!mission || source.classId !== mission.classId || !Number.isInteger(source.activityIndex) || source.activityIndex < 0 || source.activityIndex > mission.activities.length || !['active', 'paused', 'completed'].includes(source.phase) || !Number.isInteger(source.run) || source.run < 1 || !Number.isFinite(source.updatedAt)) fail('Invalid serialized session.');
      if ((source.phase === 'completed') !== (source.activityIndex === mission.activities.length)) fail('Invalid serialized session state.');
      clean.sessions.push({ id: idString(source.id, 'session ID'), missionId: mission.id, classId: mission.classId, activityIndex: source.activityIndex, phase: source.phase, run: source.run, updatedAt: source.updatedAt });
    }
    for (const source of state.responses) {
      if (!isObject(source) || !isObject(source.body) || typeof source.body.completed !== 'boolean') fail('Invalid serialized response.');
      const session = clean.sessions.find(item => item.id === source.body.sessionId);
      const mission = clean.missions.find(item => item.id === source.body.missionId);
      if (!session || !mission || session.missionId !== mission.id || source.body.classId !== mission.classId || !Number.isInteger(source.body.run) || source.body.run < 1 || !mission.activities.some(item => item.id === source.body.activityId) || !Number.isFinite(source.createdAt)) fail('Invalid serialized response.');
      const body = { sessionId: session.id, missionId: mission.id, classId: mission.classId, run: source.body.run, activityId: source.body.activityId, ...(source.body.groupId == null ? {} : { groupId: string(source.body.groupId, 80, 'group ID') }), ...(source.body.answerOptionId == null ? {} : { answerOptionId: string(source.body.answerOptionId, 80, 'answer option ID') }), completed: source.body.completed };
      const activity = mission.activities.find(item => item.id === body.activityId);
      if (body.groupId !== activity.groupId || body.completed !== true || (activity.quiz ? !activity.quiz.options.some(option => option.id === body.answerOptionId) : !!body.answerOptionId)) fail('Invalid serialized response.');
      const correct = activity.quiz?.correctOptionId ? body.answerOptionId === activity.quiz.correctOptionId : undefined;
      if (source.correct !== undefined && source.correct !== correct) fail('Invalid serialized response.');
      clean.responses.push({ id: idString(source.id, 'response ID'), body, ...(correct === undefined ? {} : { correct }), createdAt: source.createdAt });
    }
    checkState(clean);
    return clean;
  }
  return Object.freeze({ VERSION, createState, createMission, scan, respond, pause, resume, restart, serialize, deserialize });
});
