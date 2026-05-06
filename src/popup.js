const statusEl = document.getElementById("status");
const originEl = document.getElementById("origin");
const messageEl = document.getElementById("message");
const domainBadge = document.getElementById("domainBadge");
const captureBadge = document.getElementById("captureBadge");
const armedToggle = document.getElementById("armedToggle");
const startButton = document.getElementById("startButton");
const copyButton = document.getElementById("copyButton");
const viewerButton = document.getElementById("viewerButton");
const clearButton = document.getElementById("clearButton");
const LATEST_CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";

let popupState = null;

armedToggle.addEventListener("change", async () => {
  setMessage("Обновляю настройки домена...");
  setBusy(true);

  const result = await chrome.runtime.sendMessage({
    type: "SET_DOMAIN_ARMED",
    armed: armedToggle.checked
  });

  if (!result?.ok) {
    setMessage(result?.error || "Не удалось изменить режим.");
    await refreshState();
    return;
  }

  setMessage(armedToggle.checked ? "Сбор включён. Вкладка перезагружается." : "Сбор выключен. Вкладка перезагружается.");
  await refreshState();
});

startButton.addEventListener("click", async () => {
  setMessage("Запускаю выбор элемента...");
  const result = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
  if (!result?.ok) {
    setMessage(result?.error || "Не удалось запустить выбор.");
    return;
  }

  setMessage("Выбор элемента запущен.");
  window.close();
});

copyButton.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get([COPYABLE_CAPTURE_STORAGE_KEY, LATEST_CAPTURE_STORAGE_KEY]);
  const capture = stored[COPYABLE_CAPTURE_STORAGE_KEY] || stored[LATEST_CAPTURE_STORAGE_KEY];
  if (!capture) {
    setMessage("Нет сохранённого захвата. Сначала выберите элемент и сохраните capture.");
    await refreshState();
    return;
  }

  try {
    const copyPayload = buildCopyPayload(capture);
    await navigator.clipboard.writeText(JSON.stringify(copyPayload, null, 2));
    setMessage(stored[LATEST_CAPTURE_STORAGE_KEY]
      ? "Скопирован захват: DOM-структура и API-ответы."
      : "Скопирован последний локальный захват: DOM-структура и API-ответы.");
  } catch {
    setMessage("Не удалось скопировать.");
  }
});

viewerButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_RECEIVER" });
  setMessage("Viewer открыт.");
});

clearButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LATEST_CAPTURE" });
  setMessage("Данные очищены.");
  await refreshState();
});

void refreshState();

async function refreshState() {
  setBusy(true);
  popupState = await chrome.runtime.sendMessage({ type: "GET_POPUP_STATE" });
  renderState();
  setBusy(false);
}

function renderState() {
  const isSupported = Boolean(popupState?.isSupportedPage);
  const isArmed = Boolean(popupState?.isArmed);
  const hasLatestCapture = Boolean(popupState?.hasLatestCapture);
  const hasCopyableCapture = Boolean(popupState?.hasCopyableCapture);
  const hasAnyCapture = Boolean(popupState?.hasAnyCapture);

  const originText = popupState?.origin ? simplifyOrigin(popupState.origin) : "Неподдерживаемая вкладка";

  originEl.textContent = popupState?.origin || "Неподдерживаемая вкладка";
  domainBadge.textContent = originText;
  captureBadge.textContent = isArmed ? "Сбор включён" : "Сбор выключен";
  captureBadge.className = `badge ${isArmed ? "badge--active" : "badge--muted"}`;
  armedToggle.checked = isArmed;
  armedToggle.disabled = !isSupported;
  startButton.disabled = !isSupported || !isArmed;
  copyButton.disabled = !hasAnyCapture;
  copyButton.textContent = hasLatestCapture || !hasAnyCapture ? "Скопировать захват" : "Скопировать последний";
  clearButton.disabled = !hasAnyCapture;

  if (!messageEl.textContent) {
    if (hasLatestCapture) {
      setMessage("Новый захват готов: можно открыть viewer или скопировать JSON.");
    } else if (hasCopyableCapture) {
      setMessage("Viewer уже забрал одноразовый capture; локальная копия ещё доступна для повторного копирования.");
    }
  }

  if (!isSupported) {
    statusEl.textContent = "Откройте обычную страницу по http или https.";
    viewerButton.disabled = false;
    return;
  }

  statusEl.textContent = isArmed
    ? "Сбор включён для этого домена."
    : "Сбор выключен для этого домена.";
  viewerButton.disabled = false;
}

function setBusy(isBusy) {
  const hasAnyCapture = Boolean(popupState?.hasAnyCapture);
  armedToggle.disabled = isBusy || !popupState?.isSupportedPage;
  startButton.disabled = isBusy || !popupState?.isSupportedPage || !popupState?.isArmed;
  copyButton.disabled = isBusy || !hasAnyCapture;
  viewerButton.disabled = isBusy;
  clearButton.disabled = isBusy || !hasAnyCapture;
}

function setMessage(text) {
  messageEl.textContent = text;
}

function simplifyOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}


function buildCopyPayload(capture) {
  const domElement = capture?.dom?.outerHTML
    ? new DOMParser().parseFromString(capture.dom.outerHTML, "text/html").body.firstElementChild
    : null;

  return {
    dom: domElement ? buildDomTreeSnapshot(domElement) : null,
    api: (capture?.network || []).map((request) => ({
      method: request.method || "GET",
      url: request.url || "",
      status: request.status || 0,
      requestBody: request.requestBody || "",
      responseBody: request.responseBody || ""
    }))
  };
}

function buildDomTreeSnapshot(node) {
  if (!(node instanceof Element)) {
    return null;
  }

  const item = { tag: node.tagName.toLowerCase() };
  const attrs = {};

  Array.from(node.attributes || []).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (name === "class" || name === "style") {
      return;
    }
    attrs[name] = attribute.value;
  });

  if (Object.keys(attrs).length > 0) {
    item.attrs = attrs;
  }

  const children = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const nested = buildDomTreeSnapshot(child);
      if (nested) {
        children.push(nested);
      }
      return;
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const text = String(child.textContent || "").replace(/\s+/g, " ").trim();
      if (text) {
        children.push({ text });
      }
    }
  });

  if (children.length > 0) {
    item.children = children;
  }

  return item;
}
