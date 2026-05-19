const statusEl = document.getElementById("status");
const originEl = document.getElementById("origin");
const messageEl = document.getElementById("message");
const domainBadge = document.getElementById("domainBadge");
const captureBadge = document.getElementById("captureBadge");
const summaryPanel = document.getElementById("summaryPanel");
const captureReadyBadge = document.getElementById("captureReadyBadge");
const selectionSummaryEl = document.getElementById("selectionSummary");
const selectionBadge = document.getElementById("selectionBadge");
const apiCountBadge = document.getElementById("apiCountBadge");
const captureTimeBadge = document.getElementById("captureTimeBadge");
const modeNormal = document.getElementById("modeNormal");
const modePro = document.getElementById("modePro");
const armedToggle = document.getElementById("armedToggle");
const startButton = document.getElementById("startButton");
const copyButton = document.getElementById("copyButton");
const viewerButton = document.getElementById("viewerButton");
const clearButton = document.getElementById("clearButton");
const LATEST_CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";
const CAPTURE_REF_MARK = "__widgetronCaptureRef";

let popupState = null;

function setPopupStateForTest(nextState) {
  popupState = nextState;
}

modeNormal.addEventListener("change", () => {
  if (modeNormal.checked) {
    void updateCaptureMode("normal");
  }
});

modePro.addEventListener("change", () => {
  if (modePro.checked) {
    void updateCaptureMode("pro");
  }
});

armedToggle.addEventListener("change", async () => {
  setMessage("Обновляю доступ для сайта...");
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

  setMessage(
    armedToggle.checked
      ? "Готово. Вкладка перезагрузится."
      : "Сбор отключён. Вкладка перезагрузится."
  );
  await refreshState();
});

startButton.addEventListener("click", async () => {
  const isPro = popupState?.captureMode === "pro";
  setMessage(isPro ? "Запускаю выбор элемента..." : "Выберите нужный блок на странице.");
  const result = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
  if (!result?.ok) {
    setMessage(result?.error || "Не удалось запустить выбор.");
    return;
  }

  setMessage(isPro ? "Выбор элемента активирован." : "Выберите нужный блок на странице.");
  window.close();
});

copyButton.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get([COPYABLE_CAPTURE_STORAGE_KEY, LATEST_CAPTURE_STORAGE_KEY]);
  const capture = await resolveStoredCapture(stored[COPYABLE_CAPTURE_STORAGE_KEY] || stored[LATEST_CAPTURE_STORAGE_KEY], stored);
  if (!capture) {
    setMessage("Нет сохранённого захвата. Сначала выберите элемент.");
    await refreshState();
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(capture.captureBundle || capture, null, 2));
    setMessage(stored[LATEST_CAPTURE_STORAGE_KEY] ? "Захват скопирован." : "Локальная копия скопирована.");
  } catch {
    setMessage("Не удалось скопировать захват.");
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
  setMessage("Рабочая область открыта.");
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

async function updateCaptureMode(captureMode) {
  setMessage("Переключаю режим...");
  setBusy(true);
  const result = await chrome.runtime.sendMessage({
    type: "SET_CAPTURE_MODE",
    captureMode
  });
  if (!result?.ok) {
    setMessage(result?.error || "Не удалось изменить режим.");
    await refreshState();
    return;
  }
  popupState = {
    ...(popupState || {}),
    captureMode: result.captureMode || captureMode
  };
  renderState();
  setBusy(false);
  setMessage(result.captureMode === "pro" ? "Включён PRO режим." : "Включён обычный режим.");
}

function renderState() {
  const isSupported = Boolean(popupState?.isSupportedPage);
  const isArmed = Boolean(popupState?.isArmed);
  const captureMode = popupState?.captureMode === "pro" ? "pro" : "normal";
  const isPro = captureMode === "pro";
  const hasLatestCapture = Boolean(popupState?.hasLatestCapture);
  const hasCopyableCapture = Boolean(popupState?.hasCopyableCapture);
  const hasAnyCapture = Boolean(popupState?.hasAnyCapture);
  const summary = popupState?.captureSummary || null;

  const originText = popupState?.origin ? simplifyOrigin(popupState.origin) : "Неподдерживаемая вкладка";

  originEl.textContent = popupState?.origin || "Неподдерживаемая вкладка";
  domainBadge.textContent = originText;
  modeNormal.checked = !isPro;
  modePro.checked = isPro;
  captureBadge.textContent = isArmed ? "Сбор включён" : "Сбор выключен";
  captureBadge.className = `badge ${isArmed ? "badge--active" : "badge--muted"}`;
  armedToggle.checked = isArmed;
  armedToggle.disabled = !isSupported;
  startButton.disabled = !isSupported || !isArmed;
  startButton.textContent = "Выбрать элемент";
  copyButton.disabled = !hasAnyCapture;
  copyButton.textContent = hasLatestCapture || !hasAnyCapture ? "Скопировать захват" : "Скопировать последний";
  clearButton.disabled = !hasAnyCapture;
  summaryPanel.hidden = !isPro;
  viewerButton.hidden = !isPro;
  copyButton.hidden = !isPro;
  clearButton.hidden = !isPro;
  renderCaptureSummary(summary, hasAnyCapture);

  if (!messageEl.textContent) {
    if (hasLatestCapture) {
      setMessage(isPro ? "Новый захват готов." : "Готово. Контекст сохранён.");
    } else if (hasCopyableCapture) {
      setMessage(isPro ? "Последний захват ещё доступен." : "");
    }
  }

  if (!isSupported) {
    statusEl.textContent = "Откройте обычный сайт.";
    viewerButton.disabled = false;
    return;
  }

  statusEl.textContent = isArmed
    ? (isPro ? "Сбор включён для этого сайта." : "Теперь выберите нужный блок.")
    : (isPro ? "Сначала включите сбор на сайте." : "Сначала разрешите сбор на сайте.");
  viewerButton.disabled = false;
}

function renderCaptureSummary(summary, hasAnyCapture) {
  if (!summary) {
    captureReadyBadge.textContent = hasAnyCapture ? "Есть данные" : "Пусто";
    captureReadyBadge.className = `badge ${hasAnyCapture ? "badge--active" : "badge--muted"}`;
    selectionSummaryEl.textContent = hasAnyCapture
      ? "Захват сохранён, но короткое summary недоступно."
      : "Элемент ещё не выбран.";
    selectionBadge.textContent = "DOM";
    apiCountBadge.textContent = "API 0";
    captureTimeBadge.textContent = "Нет времени";
    return;
  }

  captureReadyBadge.textContent = "Готово";
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
  modeNormal.disabled = isBusy;
  modePro.disabled = isBusy;
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
