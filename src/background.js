const RECEIVER_PATH = "src/viewer.html";
const ARMED_ORIGINS_KEY = "armedOrigins";
const CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";
const CAPTURE_EXPIRY_ALARM = "latestCaptureExpiry";
const CAPTURE_TTL_MS = 5 * 60 * 1000;
const FULL_CAPTURE_DB_NAME = "vorovayka-full-capture";
const FULL_CAPTURE_STORE_NAME = "captures";
const FULL_CAPTURE_KEY = "active";

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
    await chrome.tabs.sendMessage(tab.id, { type: "START_CAPTURE" });
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

  await chrome.action.setBadgeText({
    tabId,
    text: isArmed ? "ON" : ""
  });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#0f172a"
  });
  await chrome.action.setTitle({
    tabId,
    title: isArmed
      ? "Capture armed for this domain. Open popup to control capture."
      : "Capture disabled for this domain. Open popup to arm and reload."
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

  return {
    tabId: tab?.id ?? null,
    url,
    origin,
    isSupportedPage: Boolean(origin),
    isArmed: Boolean(origin && armedOrigins[origin]),
    hasLatestCapture: Boolean(capture[CAPTURE_STORAGE_KEY]),
    hasCopyableCapture: Boolean(capture[COPYABLE_CAPTURE_STORAGE_KEY]),
    hasAnyCapture: Boolean(capture[CAPTURE_STORAGE_KEY] || capture[COPYABLE_CAPTURE_STORAGE_KEY]),
    captureSummary: capture[COPYABLE_CAPTURE_STORAGE_KEY]?.captureSummary || null
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
  await syncActionState(tab.id, tab.url);
  await chrome.tabs.reload(tab.id);

  return { isArmed: armed, reloaded: true };
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

  await chrome.tabs.sendMessage(tab.id, { type: "START_CAPTURE" });
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
