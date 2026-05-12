const statusEl = document.getElementById("status");
const originEl = document.getElementById("origin");
const messageEl = document.getElementById("message");
const domainBadge = document.getElementById("domainBadge");
const captureBadge = document.getElementById("captureBadge");
const captureReadyBadge = document.getElementById("captureReadyBadge");
const selectionSummaryEl = document.getElementById("selectionSummary");
const selectionBadge = document.getElementById("selectionBadge");
const apiCountBadge = document.getElementById("apiCountBadge");
const captureTimeBadge = document.getElementById("captureTimeBadge");
const armedToggle = document.getElementById("armedToggle");
const startButton = document.getElementById("startButton");
const copyButton = document.getElementById("copyButton");
const viewerButton = document.getElementById("viewerButton");
const clearButton = document.getElementById("clearButton");
const LATEST_CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";
const CAPTURE_REF_MARK = "__vorovaykaCaptureRef";

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
  const capture = await resolveStoredCapture(stored[COPYABLE_CAPTURE_STORAGE_KEY] || stored[LATEST_CAPTURE_STORAGE_KEY], stored);
  if (!capture) {
    setMessage("Нет сохранённого захвата. Сначала выберите элемент и сохраните capture.");
    await refreshState();
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(capture.captureBundle || capture, null, 2));
    setMessage(stored[LATEST_CAPTURE_STORAGE_KEY]
      ? "Захват скопирован."
      : "Скопирована локальная копия захвата.");
  } catch {
    setMessage("Не удалось скопировать.");
  }
});

async function resolveStoredCapture(value, stored) {
  if (value?.[CAPTURE_REF_MARK]) {
    if (value.fullCaptureAvailable) {
      const response = await chrome.runtime.sendMessage({
        type: "GET_FULL_CAPTURE",
        fullCaptureKey: value.fullCaptureKey
      }).catch(() => null);
      if (response?.ok && response.capture) {
        return response.capture;
      }
    }

    return stored[value.storageKey || COPYABLE_CAPTURE_STORAGE_KEY] || null;
  }

  if (value?.storageMeta?.fullCaptureAvailable) {
    const response = await chrome.runtime.sendMessage({
      type: "GET_FULL_CAPTURE",
      fullCaptureKey: value.storageMeta.fullCaptureKey
    }).catch(() => null);
    if (response?.ok && response.capture) {
      return response.capture;
    }
  }

  return value || null;
}

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
  const summary = popupState?.captureSummary || null;

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
  renderCaptureSummary(summary, hasAnyCapture);

  if (!messageEl.textContent) {
    if (hasLatestCapture) {
      setMessage("Новый захват готов.");
    } else if (hasCopyableCapture) {
      setMessage("Локальная копия захвата ещё доступна.");
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

function renderCaptureSummary(summary, hasAnyCapture) {
  if (!summary) {
    captureReadyBadge.textContent = hasAnyCapture ? "Есть" : "Пусто";
    captureReadyBadge.className = `badge ${hasAnyCapture ? "badge--active" : "badge--muted"}`;
    selectionSummaryEl.textContent = hasAnyCapture ? "Захват сохранён, но summary недоступен." : "Элемент ещё не выбран.";
    selectionBadge.textContent = "DOM";
    apiCountBadge.textContent = "API 0";
    captureTimeBadge.textContent = "Нет времени";
    return;
  }

  captureReadyBadge.textContent = "Готов";
  captureReadyBadge.className = "badge badge--active";
  selectionSummaryEl.textContent = [
    summary.tagName ? `<${summary.tagName}>` : "DOM",
    summary.textPreview || "без текста"
  ].join(" · ");
  selectionBadge.textContent = summary.tagName ? `<${summary.tagName}>` : "DOM";
  apiCountBadge.textContent = `API ${summary.apiCount || 0}`;
  captureTimeBadge.textContent = formatCaptureTime(summary.capturedAt);
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

function formatCaptureTime(value) {
  if (!value) {
    return "Нет времени";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Без даты";
  }

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  });
}
