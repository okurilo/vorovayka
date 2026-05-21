const RECEIVER_PATH = "src/viewer.html";
const ARMED_ORIGINS_KEY = "armedOrigins";
const CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";
const CAPTURE_MODE_STORAGE_KEY = "captureMode";
const PROCESS_RECORDING_STATE_KEY = "processRecordingState";
const CAPTURE_EXPIRY_ALARM = "latestCaptureExpiry";
const CAPTURE_TTL_MS = 5 * 60 * 1000;
const FULL_CAPTURE_DB_NAME = "widgetron-full-capture";
const FULL_CAPTURE_STORE_NAME = "captures";
const FULL_CAPTURE_KEY = "active";
const PROCESS_RECORDING_DB_NAME = "widgetron-process-recording";
const PROCESS_RECORDING_STORE_NAME = "recordings";
const PROCESS_RECORDING_ACTIVE_KEY = "active";
const MAX_PROCESS_EVENTS = 400;
const MAX_PROCESS_BODY_CHARS = 96 * 1024;
const MAX_PROCESS_STACK_CHARS = 6 * 1024;

let processAppendQueue = Promise.resolve();

initialize();

async function initialize() {
  await clearEphemeralCapture();

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await syncActionState(tab?.id, tab?.url);
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "loading" || changeInfo.url) {
      await syncActionState(tabId, tab?.url ?? changeInfo.url);
    }
  });
}

async function handleCaptureAction() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    return;
  }

  const origin = getOrigin(tab.url);
  if (!origin) {
    return;
  }

  const armedOrigins = await getArmedOrigins();
  if (!armedOrigins[origin]) {
    armedOrigins[origin] = true;
    await chrome.storage.local.set({ [ARMED_ORIGINS_KEY]: armedOrigins });
    await syncActionState(tab.id, tab.url);
    await chrome.tabs.reload(tab.id);
    return;
  }

  try {
    const captureMode = await getCaptureMode();
    await chrome.tabs.sendMessage(tab.id, {
      type: "START_CAPTURE",
      captureMode
    });
  } catch (error) {
    console.warn("Failed to start capture on active tab", error);
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "start-capture") {
    await handleCaptureAction();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CAPTURE_EXPIRY_ALARM) {
    await clearEphemeralCapture();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await clearEphemeralCapture();
});

chrome.runtime.onInstalled.addListener(async () => {
  await clearEphemeralCapture();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_RECEIVER") {
    chrome.tabs.create({
      url: chrome.runtime.getURL(RECEIVER_PATH),
      index: sender.tab?.index != null ? sender.tab.index + 1 : undefined
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "SCHEDULE_CAPTURE_EXPIRY") {
    chrome.alarms.create(CAPTURE_EXPIRY_ALARM, {
      when: Date.now() + CAPTURE_TTL_MS
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GET_POPUP_STATE") {
    void getPopupState().then((state) => sendResponse(state));
    return true;
  }

  if (message?.type === "SET_CAPTURE_MODE") {
    void setCaptureMode(message.captureMode)
      .then((captureMode) => sendResponse({ ok: true, captureMode }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "GET_PROCESS_RECORDING_STATE") {
    void getProcessRecordingState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "STORE_FULL_CAPTURE") {
    void storeFullCapture(message.capture)
      .then(() => sendResponse({ ok: true, fullCaptureKey: FULL_CAPTURE_KEY }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "GET_FULL_CAPTURE") {
    void getFullCapture()
      .then((capture) => sendResponse({ ok: true, capture }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "SET_DOMAIN_ARMED") {
    void setCurrentDomainArmed(Boolean(message.armed))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "START_CAPTURE") {
    void startCaptureOnActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "START_PROCESS_RECORDING") {
    void startProcessRecording(message.name)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "STOP_PROCESS_RECORDING") {
    void stopProcessRecording()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "APPEND_PROCESS_RECORDING_EVENT") {
    processAppendQueue = processAppendQueue
      .then(() => appendProcessRecordingEvent(message.event, sender))
      .then((result) => {
        sendResponse({ ok: true, ...result });
        return null;
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error) });
        return null;
      });
    return true;
  }

  if (message?.type === "GET_PROCESS_RECORDING") {
    void getLastProcessRecording()
      .then((recording) => sendResponse({ ok: true, recording }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "OPEN_PROCESS_VIEWER") {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`${RECEIVER_PATH}?mode=process`),
      index: sender.tab?.index != null ? sender.tab.index + 1 : undefined
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "CLEAR_LATEST_CAPTURE") {
    void clearEphemeralCapture().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

async function getArmedOrigins() {
  const stored = await chrome.storage.local.get(ARMED_ORIGINS_KEY);
  return isPlainObject(stored[ARMED_ORIGINS_KEY]) ? stored[ARMED_ORIGINS_KEY] : {};
}

async function getCaptureMode() {
  const stored = await chrome.storage.local.get(CAPTURE_MODE_STORAGE_KEY);
  return normalizeCaptureMode(stored[CAPTURE_MODE_STORAGE_KEY]);
}

function normalizeCaptureMode(value) {
  return value === "pro" ? "pro" : "normal";
}

function getOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

async function syncActionState(tabId, url) {
  if (!tabId) {
    return;
  }

  const origin = url ? getOrigin(url) : null;
  const armedOrigins = origin ? await getArmedOrigins() : {};
  const isArmed = Boolean(origin && armedOrigins[origin]);
  const processState = await getProcessRecordingState().catch(() => null);
  const isRecording = Boolean(processState?.active && origin && processState.origin === origin);

  await chrome.action.setBadgeText({
    tabId,
    text: isRecording ? "REC" : isArmed ? "ON" : ""
  });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: isRecording ? "#dc2626" : "#0f172a"
  });
  await chrome.action.setTitle({
    tabId,
    title: isRecording
      ? "Виджетрон: идёт запись процесса для этого домена."
      : isArmed
      ? "Виджетрон: захват включён для этого домена. Откройте popup для управления."
      : "Виджетрон: захват выключен. Откройте popup, чтобы включить режим и перезагрузить вкладку."
  });
}

async function clearEphemeralCapture() {
  await chrome.storage.local.remove([CAPTURE_STORAGE_KEY, COPYABLE_CAPTURE_STORAGE_KEY]);
  await chrome.alarms.clear(CAPTURE_EXPIRY_ALARM);
  await clearFullCapture();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function getPopupState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  const origin = getOrigin(url);
  const armedOrigins = origin ? await getArmedOrigins() : {};
  const capture = await chrome.storage.local.get([CAPTURE_STORAGE_KEY, COPYABLE_CAPTURE_STORAGE_KEY]);
  const captureMode = await getCaptureMode();
  const processRecording = await getProcessRecordingState();

  return {
    tabId: tab?.id ?? null,
    url,
    origin,
    captureMode,
    isSupportedPage: Boolean(origin),
    isArmed: Boolean(origin && armedOrigins[origin]),
    hasLatestCapture: Boolean(capture[CAPTURE_STORAGE_KEY]),
    hasCopyableCapture: Boolean(capture[COPYABLE_CAPTURE_STORAGE_KEY]),
    hasAnyCapture: Boolean(capture[CAPTURE_STORAGE_KEY] || capture[COPYABLE_CAPTURE_STORAGE_KEY]),
    captureSummary: capture[COPYABLE_CAPTURE_STORAGE_KEY]?.captureSummary || null,
    processRecording
  };
}

async function setCurrentDomainArmed(armed) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Active tab is not available");
  }

  const origin = getOrigin(tab.url);
  if (!origin) {
    throw new Error("Current tab does not support capture");
  }

  const armedOrigins = await getArmedOrigins();
  if (armed) {
    armedOrigins[origin] = true;
  } else {
    delete armedOrigins[origin];
  }

  await chrome.storage.local.set({ [ARMED_ORIGINS_KEY]: armedOrigins });
  if (!armed) {
    const processState = await getProcessRecordingState();
    if (processState?.active && processState.origin === origin) {
      await stopProcessRecording();
    }
  }
  await syncActionState(tab.id, tab.url);
  await chrome.tabs.reload(tab.id);

  return { isArmed: armed, reloaded: true };
}

async function setCaptureMode(captureMode) {
  const normalized = normalizeCaptureMode(captureMode);
  await chrome.storage.local.set({
    [CAPTURE_MODE_STORAGE_KEY]: normalized
  });
  return normalized;
}

async function startCaptureOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Active tab is not available");
  }

  const origin = getOrigin(tab.url);
  if (!origin) {
    throw new Error("Current tab does not support capture");
  }

  const armedOrigins = await getArmedOrigins();
  if (!armedOrigins[origin]) {
    throw new Error("Capture is disabled for this domain");
  }

  const captureMode = await getCaptureMode();
  await chrome.tabs.sendMessage(tab.id, {
    type: "START_CAPTURE",
    captureMode
  });
  return { started: true };
}

function openFullCaptureDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FULL_CAPTURE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FULL_CAPTURE_STORE_NAME)) {
        db.createObjectStore(FULL_CAPTURE_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open full capture DB"));
  });
}

async function withFullCaptureStore(mode, handler) {
  const db = await openFullCaptureDb();
  try {
    const tx = db.transaction(FULL_CAPTURE_STORE_NAME, mode);
    const store = tx.objectStore(FULL_CAPTURE_STORE_NAME);
    const result = await handler(store);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

async function storeFullCapture(capture) {
  if (!capture) {
    throw new Error("Capture payload is required");
  }

  await withFullCaptureStore("readwrite", async (store) => {
    store.put({
      id: FULL_CAPTURE_KEY,
      createdAt: Date.now(),
      capture
    });
  });
}

async function getFullCapture() {
  const record = await withFullCaptureStore("readonly", (store) => requestToPromise(store.get(FULL_CAPTURE_KEY)));
  return record?.capture || null;
}

async function clearFullCapture() {
  await withFullCaptureStore("readwrite", (store) => requestToPromise(store.delete(FULL_CAPTURE_KEY))).catch(() => null);
}

async function startProcessRecording(name) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Active tab is not available");
  }

  const origin = getOrigin(tab.url);
  if (!origin) {
    throw new Error("Current tab does not support process recording");
  }

  const armedOrigins = await getArmedOrigins();
  if (!armedOrigins[origin]) {
    throw new Error("Capture is disabled for this domain");
  }

  const currentState = await getProcessRecordingState();
  if (currentState?.active) {
    throw new Error("Process recording is already active");
  }

  const now = new Date().toISOString();
  const recordingName = normalizeProcessName(name, now);
  const recording = {
    id: PROCESS_RECORDING_ACTIVE_KEY,
    processId: createProcessId(),
    specVersion: "widgetron.process-recording.v1",
    status: "recording",
    name: recordingName,
    origin,
    startedAt: now,
    stoppedAt: "",
    page: {
      url: tab.url,
      title: tab.title || ""
    },
    eventCount: 0,
    storedEventCount: 0,
    droppedEventCount: 0,
    events: []
  };

  await storeProcessRecording(recording);
  const state = buildProcessState(recording, { active: true });
  await chrome.storage.local.set({ [PROCESS_RECORDING_STATE_KEY]: state });

  await chrome.tabs.sendMessage(tab.id, {
    type: "START_PROCESS_RECORDING",
    recording: state
  }).catch(() => null);
  await syncActionState(tab.id, tab.url);

  return { processRecording: state };
}

async function stopProcessRecording() {
  const state = await getProcessRecordingState();
  if (!state?.active) {
    throw new Error("Process recording is not active");
  }

  const recording = await getStoredProcessRecording();
  const stoppedAt = new Date().toISOString();
  const nextRecording = {
    ...(recording || {
      id: PROCESS_RECORDING_ACTIVE_KEY,
      processId: state.processId || createProcessId(),
      specVersion: "widgetron.process-recording.v1",
      name: state.name || "Процесс",
      origin: state.origin || "",
      startedAt: state.startedAt || stoppedAt,
      page: state.page || {},
      events: []
    }),
    status: "stopped",
    stoppedAt
  };
  nextRecording.eventCount = Number(nextRecording.eventCount || nextRecording.events?.length || 0);
  nextRecording.storedEventCount = Array.isArray(nextRecording.events) ? nextRecording.events.length : 0;

  await storeProcessRecording(nextRecording);
  const nextState = buildProcessState(nextRecording, { active: false });
  await chrome.storage.local.set({ [PROCESS_RECORDING_STATE_KEY]: nextState });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, { type: "STOP_PROCESS_RECORDING" }).catch(() => null);
    await syncActionState(tab.id, tab.url);
  }

  return { processRecording: nextState };
}

async function appendProcessRecordingEvent(event, sender) {
  const state = await getProcessRecordingState();
  if (!state?.active) {
    return { ignored: true };
  }

  const senderOrigin = getOrigin(sender?.tab?.url || event?.page?.url || "");
  if (!senderOrigin || senderOrigin !== state.origin) {
    return { ignored: true };
  }

  const armedOrigins = await getArmedOrigins();
  if (!armedOrigins[senderOrigin]) {
    return { ignored: true };
  }

  const recording = await getStoredProcessRecording();
  if (!recording || recording.status !== "recording") {
    return { ignored: true };
  }

  const nextEventCount = Number(recording.eventCount || 0) + 1;
  const normalizedEvent = normalizeProcessEvent(event, {
    step: nextEventCount,
    startedAt: recording.startedAt,
    senderTab: sender?.tab || {}
  });
  if (!normalizedEvent) {
    return { ignored: true };
  }

  const events = Array.isArray(recording.events) ? recording.events.slice() : [];
  events.push(normalizedEvent);
  const droppedByLimit = Math.max(0, events.length - MAX_PROCESS_EVENTS);
  const storedEvents = droppedByLimit > 0 ? events.slice(droppedByLimit) : events;
  const nextRecording = {
    ...recording,
    eventCount: nextEventCount,
    storedEventCount: storedEvents.length,
    droppedEventCount: Number(recording.droppedEventCount || 0) + droppedByLimit,
    lastEventAt: normalizedEvent.timestamp,
    events: storedEvents
  };

  await storeProcessRecording(nextRecording);
  const nextState = buildProcessState(nextRecording, { active: true });
  await chrome.storage.local.set({ [PROCESS_RECORDING_STATE_KEY]: nextState });
  return {
    ignored: false,
    eventCount: nextRecording.eventCount,
    storedEventCount: nextRecording.storedEventCount
  };
}

async function getLastProcessRecording() {
  return await getStoredProcessRecording();
}

async function getProcessRecordingState() {
  const stored = await chrome.storage.local.get(PROCESS_RECORDING_STATE_KEY);
  return normalizeProcessState(stored[PROCESS_RECORDING_STATE_KEY]);
}

function buildProcessState(recording, options = {}) {
  return {
    active: Boolean(options.active),
    status: options.active ? "recording" : "stopped",
    id: recording.id || PROCESS_RECORDING_ACTIVE_KEY,
    processId: recording.processId || "",
    name: recording.name || "Процесс",
    origin: recording.origin || "",
    startedAt: recording.startedAt || "",
    stoppedAt: recording.stoppedAt || "",
    page: recording.page || {},
    eventCount: Number(recording.eventCount || 0),
    storedEventCount: Number(recording.storedEventCount || recording.events?.length || 0),
    droppedEventCount: Number(recording.droppedEventCount || 0),
    lastEventAt: recording.lastEventAt || ""
  };
}

function normalizeProcessState(value) {
  if (!isPlainObject(value)) {
    return {
      active: false,
      status: "empty",
      id: "",
      processId: "",
      name: "",
      origin: "",
      startedAt: "",
      stoppedAt: "",
      page: {},
      eventCount: 0,
      storedEventCount: 0,
      droppedEventCount: 0,
      lastEventAt: ""
    };
  }

  return {
    active: Boolean(value.active),
    status: value.active ? "recording" : String(value.status || "stopped"),
    id: String(value.id || ""),
    processId: String(value.processId || ""),
    name: String(value.name || ""),
    origin: String(value.origin || ""),
    startedAt: String(value.startedAt || ""),
    stoppedAt: String(value.stoppedAt || ""),
    page: isPlainObject(value.page) ? value.page : {},
    eventCount: Number(value.eventCount || 0),
    storedEventCount: Number(value.storedEventCount || 0),
    droppedEventCount: Number(value.droppedEventCount || 0),
    lastEventAt: String(value.lastEventAt || "")
  };
}

function normalizeProcessEvent(event, context = {}) {
  if (!isPlainObject(event)) {
    return null;
  }

  const type = String(event.type || "api");
  if (type !== "api") {
    return null;
  }

  const timestamp = Number(event.timestamp || Date.now());
  const startedAtMs = Date.parse(context.startedAt || "");
  const responseBody = truncateStorageText(event.responseBody, MAX_PROCESS_BODY_CHARS);
  const requestBody = truncateStorageText(event.requestBody, MAX_PROCESS_BODY_CHARS);

  return {
    id: String(event.id || `process-event-${Date.now()}-${context.step || 0}`),
    type: "api",
    step: Number(context.step || event.step || 0),
    timestamp,
    calledAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "",
    relativeToStartMs: Number.isFinite(startedAtMs) && Number.isFinite(timestamp)
      ? Math.max(0, Math.round(timestamp - startedAtMs))
      : null,
    page: {
      url: String(event.page?.url || context.senderTab?.url || ""),
      title: String(event.page?.title || context.senderTab?.title || "")
    },
    method: String(event.method || "GET").toUpperCase(),
    url: String(event.url || ""),
    status: Number(event.status || 0),
    contentType: String(event.contentType || ""),
    requestHeaders: sanitizeHeaderMap(event.requestHeaders),
    requestBody,
    responseHeaders: sanitizeHeaderMap(event.responseHeaders),
    responseBody,
    responsePreview: truncateStorageText(event.responsePreview, 500),
    responseShape: isPlainObject(event.responseShape) ? event.responseShape : {},
    initiatorStack: truncateStorageText(event.initiatorStack, MAX_PROCESS_STACK_CHARS),
    bodyTooLarge: Boolean(
      event.bodyTooLarge ||
      String(event.responseBody || "").length > responseBody.length ||
      String(event.requestBody || "").length > requestBody.length
    )
  };
}

function sanitizeHeaderMap(headers) {
  if (!isPlainObject(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => !/(token|secret|password|authorization|cookie|session|csrf|xsrf|api[-_]?key|jwt|set-cookie)/i.test(key))
      .map(([key, value]) => [String(key), truncateStorageText(String(value || ""), 1000)])
  );
}

function normalizeProcessName(name, startedAt) {
  const text = truncateStorageText(String(name || "").replace(/\s+/g, " ").trim(), 80);
  if (text) {
    return text;
  }

  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) {
    return "Процесс";
  }

  return `Процесс ${date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function createProcessId() {
  return `process-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function truncateStorageText(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 14))}...[truncated]`;
}

function openProcessRecordingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROCESS_RECORDING_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROCESS_RECORDING_STORE_NAME)) {
        db.createObjectStore(PROCESS_RECORDING_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open process recording DB"));
  });
}

async function withProcessRecordingStore(mode, handler) {
  const db = await openProcessRecordingDb();
  try {
    const tx = db.transaction(PROCESS_RECORDING_STORE_NAME, mode);
    const store = tx.objectStore(PROCESS_RECORDING_STORE_NAME);
    const result = await handler(store);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

async function storeProcessRecording(recording) {
  await withProcessRecordingStore("readwrite", async (store) => {
    store.put({
      ...recording,
      id: PROCESS_RECORDING_ACTIVE_KEY
    });
  });
}

async function getStoredProcessRecording() {
  return await withProcessRecordingStore("readonly", (store) => requestToPromise(store.get(PROCESS_RECORDING_ACTIVE_KEY)))
    .catch(() => null);
}


