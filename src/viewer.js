const stateEl = document.getElementById("state");
const jsonEl = document.getElementById("json");
const rawJsonPanelEl = document.querySelector(".debug-panel");
const LATEST_CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";
const CAPTURE_REF_MARK = "__widgetronCaptureRef";
const MAX_OPENAPI_SCHEMA_DEPTH = 8;
const MAX_OPENAPI_SCHEMA_PROPERTIES = 64;
const MAX_SCHEMA_EXAMPLES_PER_FIELD = 3;
const PROCESS_EXPORT_REQUEST_BODY_CHARS = 1600;
const PROCESS_EXPORT_URL_CHARS = 1200;
const PROCESS_EXPORT_STRING_CHARS = 240;
const PROCESS_EXPORT_JSON_DEPTH = 5;
const PROCESS_EXPORT_JSON_PROPERTIES = 24;
const PROCESS_EXPORT_JSON_ARRAY_ITEMS = 8;

chrome.storage.onChanged.addListener((changes, area) => {
  if (isProcessViewMode()) {
    return;
  }

  if (area !== "local" || !changes[LATEST_CAPTURE_STORAGE_KEY]?.newValue) {
    return;
  }

  void renderStoredCapture(changes[LATEST_CAPTURE_STORAGE_KEY].newValue, {
    removeLatest: true
  });
});

init();

async function init() {
  if (isProcessViewMode()) {
    await renderProcessRecordingPage();
    return;
  }

  const stored = await chrome.storage.local.get([LATEST_CAPTURE_STORAGE_KEY, COPYABLE_CAPTURE_STORAGE_KEY]);
  if (stored[LATEST_CAPTURE_STORAGE_KEY]) {
    await renderStoredCapture(stored[LATEST_CAPTURE_STORAGE_KEY], {
      fallbackCapture: stored[COPYABLE_CAPTURE_STORAGE_KEY],
      removeLatest: true
    });
    return;
  }

  if (stored[COPYABLE_CAPTURE_STORAGE_KEY]) {
    const capture = await resolveStoredCapture(stored[COPYABLE_CAPTURE_STORAGE_KEY]);
    renderCapture(capture || stored[COPYABLE_CAPTURE_STORAGE_KEY]);
  }
}

function isProcessViewMode() {
  try {
    return new URLSearchParams(location.search || "").get("mode") === "process";
  } catch {
    return false;
  }
}

async function renderStoredCapture(storedCapture, options = {}) {
  const capture = await resolveStoredCapture(storedCapture, options.fallbackCapture);
  if (capture) {
    renderCapture(capture);
  }
  if (options.removeLatest) {
    await chrome.storage.local.remove(LATEST_CAPTURE_STORAGE_KEY);
  }
}

async function resolveStoredCapture(value, fallbackCapture = null) {
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

    if (fallbackCapture) {
      return fallbackCapture;
    }
    const key = value.storageKey || COPYABLE_CAPTURE_STORAGE_KEY;
    const stored = await chrome.storage.local.get(key);
    return await resolveStoredCapture(stored[key] || null);
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

function renderCapture(capture) {
  const bundle = normalizeCaptureBundle(capture);
  const recipe = getElementRecipe(capture);
  stateEl.innerHTML = "";

  if (!bundle) {
    stateEl.innerHTML = "<section class=\"card\"><p>Не удалось прочитать сохранённый захват.</p></section>";
    return;
  }

  const root = document.createElement("div");
  root.className = "viewer-grid";
  const warnings = renderCaptureWarnings(capture);
  if (warnings) {
    root.append(warnings);
  }
  root.append(
    renderOverview(bundle, recipe),
    renderApiSection(bundle),
    renderExportSection(bundle, recipe)
  );

  stateEl.appendChild(root);
  if (rawJsonPanelEl) {
    rawJsonPanelEl.open = false;
  }
  jsonEl.textContent = JSON.stringify(capture, null, 2);
}

async function renderProcessRecordingPage() {
  stateEl.innerHTML = "";

  const response = await chrome.runtime.sendMessage({ type: "GET_PROCESS_RECORDING" }).catch(() => null);
  const recording = normalizeProcessRecording(response?.recording);

  if (!recording) {
    stateEl.innerHTML = "<section class=\"card\"><p>Запись процесса ещё не создана.</p></section>";
    jsonEl.textContent = "";
    return;
  }

  const root = document.createElement("div");
  root.className = "viewer-grid";
  root.append(
    renderProcessOverview(recording),
    renderProcessTimeline(recording),
    renderProcessExportSection(recording)
  );
  stateEl.appendChild(root);
  if (rawJsonPanelEl) {
    rawJsonPanelEl.open = false;
  }
  jsonEl.textContent = JSON.stringify(recording, null, 2);
}

function normalizeProcessRecording(recording) {
  if (!recording || !Array.isArray(recording.events)) {
    return null;
  }

  return {
    specVersion: recording.specVersion || "widgetron.process-recording.v1",
    processId: recording.processId || recording.id || "",
    name: recording.name || "Процесс",
    status: recording.status || "stopped",
    origin: recording.origin || "",
    startedAt: recording.startedAt || "",
    stoppedAt: recording.stoppedAt || "",
    page: recording.page || {},
    eventCount: Number(recording.eventCount || recording.events.length || 0),
    storedEventCount: Number(recording.storedEventCount || recording.events.length || 0),
    droppedEventCount: Number(recording.droppedEventCount || 0),
    events: recording.events
  };
}

function renderProcessOverview(recording) {
  const section = document.createElement("section");
  section.className = "card overview";

  section.innerHTML = `
    <div class="section-head">
      <div>
        <h2>${escapeHtml(recording.name)}</h2>
        <p class="section-copy">${escapeHtml(recording.origin || recording.page?.url || "Домен не указан")}</p>
      </div>
      <span class="pill">${escapeHtml(recording.status === "recording" ? "Идёт запись" : "Остановлено")}</span>
    </div>
    <div class="meta-grid meta-grid--process">
      ${renderMetric("Старт", formatCapturedAt(recording.startedAt))}
      ${renderMetric("Стоп", recording.stoppedAt ? formatCapturedAt(recording.stoppedAt) : "Идёт сейчас")}
      ${renderMetric("API-события", String(recording.eventCount || 0))}
      ${renderMetric("В хранилище", String(recording.storedEventCount || recording.events.length || 0))}
    </div>
  `;

  if (recording.droppedEventCount > 0) {
    const warning = document.createElement("p");
    warning.className = "section-copy process-warning";
    warning.textContent = `Первые ${recording.droppedEventCount} событий вытеснены лимитом локальной записи.`;
    section.appendChild(warning);
  }

  return section;
}

function renderProcessTimeline(recording) {
  const section = document.createElement("section");
  section.className = "card";

  const apiEvents = recording.events.filter((event) => event.type === "api");
  section.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Хронология API</h2>
        <p class="section-copy">Последовательность вызовов, request/response данные и источник вызова для восстановления процесса.</p>
      </div>
      <span class="count-badge">${escapeHtml(String(apiEvents.length))}</span>
    </div>
  `;

  if (!apiEvents.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Во время записи API-вызовы ещё не накоплены.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "process-timeline";
  apiEvents.forEach((event) => {
    const card = document.createElement("article");
    card.className = "api-card process-event";
    card.innerHTML = `
      <div class="api-card__top">
        <div class="process-event__title">
          <span class="count-badge">#${escapeHtml(String(event.step || ""))}</span>
          <strong>${escapeHtml(event.method || "GET")} ${escapeHtml(shortenUrl(event.url || ""))}</strong>
        </div>
        <span class="api-status">Статус ${escapeHtml(String(event.status || "?"))}</span>
      </div>
      <p class="api-copy">${escapeHtml(event.responsePreview || "Короткое превью ответа недоступно.")}</p>
      <p class="api-copy">${escapeHtml(formatProcessEventTiming(event))}</p>
      <details class="api-details">
        <summary>Request / response</summary>
        <div class="api-detail-grid">
          ${renderCodeBlock("Request body", event.requestBody || "—")}
          ${renderCodeBlock("Response body", event.responseBody || "—")}
          ${renderCodeBlock("Initiator stack", event.initiatorStack || "—")}
        </div>
      </details>
    `;
    list.appendChild(card);
  });

  section.appendChild(list);
  return section;
}

function renderProcessExportSection(recording) {
  const section = document.createElement("section");
  section.className = "card";
  section.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Экспорт процесса</h2>
        <p class="section-copy">LLM-компактный payload: порядок API, короткие request body, response preview и схемы без сырых response body.</p>
      </div>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "export-actions";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Скопировать процесс";
  const status = document.createElement("span");
  status.className = "export-status";
  actions.append(copyButton, status);

  const preview = document.createElement("pre");
  preview.className = "export-preview";
  const payload = buildProcessExportPayload(recording);
  preview.textContent = JSON.stringify(payload, null, 2);

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      status.textContent = "Скопировано.";
    } catch {
      status.textContent = "Не удалось скопировать.";
    }
  });

  section.append(actions, preview);
  return section;
}

function buildProcessExportPayload(recording) {
  const normalized = normalizeProcessRecording(recording);
  if (!normalized) {
    return null;
  }

  const apiEvents = normalized.events.filter((event) => event.type === "api");
  return {
    specVersion: "widgetron.process-export.v1",
    exportProfile: "llm-compact",
    process: {
      id: normalized.processId,
      name: normalized.name,
      status: normalized.status,
      origin: normalized.origin,
      startedAt: normalized.startedAt,
      stoppedAt: normalized.stoppedAt,
      page: normalized.page,
      eventCount: normalized.eventCount,
      storedEventCount: normalized.storedEventCount,
      droppedEventCount: normalized.droppedEventCount
    },
    omittedFromCompactExport: {
      requestHeaders: true,
      responseHeaders: true,
      responseBodies: true,
      initiatorStacks: true,
      note: "Full local details remain in the process viewer; this export is sized for LLM context."
    },
    limits: {
      requestBodyChars: PROCESS_EXPORT_REQUEST_BODY_CHARS,
      urlChars: PROCESS_EXPORT_URL_CHARS,
      jsonDepth: PROCESS_EXPORT_JSON_DEPTH,
      jsonProperties: PROCESS_EXPORT_JSON_PROPERTIES,
      jsonArrayItems: PROCESS_EXPORT_JSON_ARRAY_ITEMS
    },
    apiFlow: apiEvents.map((event, index) => ({
      step: event.step || index + 1,
      calledAt: event.calledAt || (event.timestamp ? new Date(Number(event.timestamp)).toISOString() : ""),
      relativeToStartMs: Number.isFinite(Number(event.relativeToStartMs)) ? Number(event.relativeToStartMs) : null,
      request: {
        method: event.method || "GET",
        url: compactProcessExportUrl(event.url || ""),
        body: compactProcessExportBody(event.requestBody, event.contentType, PROCESS_EXPORT_REQUEST_BODY_CHARS)
      },
      response: {
        status: event.status || 0,
        contentType: event.contentType || "",
        preview: event.responsePreview || buildResponsePreview(event.responseBody, event.contentType),
        schema: buildProcessResponseSchema(event),
        bodyOmitted: Boolean(event.responseBody)
      }
    }))
  };
}

function compactProcessExportUrl(url) {
  const text = String(url || "");
  if (!text) {
    return "";
  }

  try {
    const parsed = new URL(text);
    const params = Array.from(parsed.searchParams.entries());
    if (!params.length && text.length <= PROCESS_EXPORT_URL_CHARS) {
      return text;
    }

    const keptParams = params.slice(0, 10).map(([key, value]) => [
      truncateProcessExportText(key, 60),
      truncateProcessExportText(value, 160)
    ]);
    if (params.length > keptParams.length) {
      keptParams.push(["__omittedParams", String(params.length - keptParams.length)]);
    }
    parsed.search = new URLSearchParams(keptParams).toString();
    return truncateProcessExportText(parsed.toString(), PROCESS_EXPORT_URL_CHARS);
  } catch {
    return truncateProcessExportText(text, PROCESS_EXPORT_URL_CHARS);
  }
}

function compactProcessExportBody(body, contentType, maxChars) {
  const text = String(body || "").trim();
  if (!text) {
    return "";
  }

  const parsed = parseJsonBody(text, contentType);
  if (parsed !== null || text === "null") {
    const compact = compactJsonValueForProcessExport(parsed);
    return truncateProcessExportText(JSON.stringify(compact), maxChars);
  }

  return truncateProcessExportText(text, maxChars);
}

function compactJsonValueForProcessExport(value, depth = 0) {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return truncateProcessExportText(value, PROCESS_EXPORT_STRING_CHARS);
  }

  if (depth >= PROCESS_EXPORT_JSON_DEPTH) {
    return Array.isArray(value) ? "[array omitted by depth]" : "{object omitted by depth}";
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, PROCESS_EXPORT_JSON_ARRAY_ITEMS)
      .map((item) => compactJsonValueForProcessExport(item, depth + 1));
    if (value.length > items.length) {
      items.push(`...[${value.length - items.length} items omitted]`);
    }
    return items;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    const compact = {};
    entries.slice(0, PROCESS_EXPORT_JSON_PROPERTIES).forEach(([key, item]) => {
      compact[key] = compactJsonValueForProcessExport(item, depth + 1);
    });
    if (entries.length > PROCESS_EXPORT_JSON_PROPERTIES) {
      compact.__omittedKeys = entries.length - PROCESS_EXPORT_JSON_PROPERTIES;
    }
    return compact;
  }

  return String(value);
}

function truncateProcessExportText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 15))}...[truncated]`;
}

function buildProcessResponseSchema(event) {
  if (event?.responseShape && Object.keys(event.responseShape).length > 0) {
    const parsed = parseJsonBody(event.responseBody, event.contentType);
    const rawBody = String(event.responseBody || "").trim();
    const sampleValue = parsed !== null || rawBody === "null" ? parsed : undefined;
    return normalizeSchemaShape(event.responseShape, sampleValue, event.contentType);
  }

  return extractResponseShape(event);
}

function formatProcessEventTiming(event) {
  const parts = [];
  if (event.calledAt) {
    parts.push(new Date(event.calledAt).toLocaleString("ru-RU"));
  }
  if (Number.isFinite(Number(event.relativeToStartMs))) {
    parts.push(`${event.relativeToStartMs} ms от старта`);
  }
  return parts.join(" · ") || "Время вызова не записано";
}

function normalizeCaptureBundle(capture) {
  if (capture?.captureBundle) {
    return capture.captureBundle;
  }

  if (!capture) {
    return null;
  }

  return {
    specVersion: "widgetron.capture-bundle.v1",
    capturedAt: capture.createdAt || "",
    page: {
      title: capture.page?.title || "",
      url: capture.page?.url || ""
    },
    selection: {
      type: capture.interaction?.type || "",
      timestamp: capture.interaction?.timestamp || 0,
      mode: capture.captureMode || "pro"
    },
    dom: {
      tagName: capture.dom?.tagName || "",
      selector: capture.dom?.selector || "",
      textPreview: capture.dom?.innerText || "",
      rect: capture.dom?.rect || {},
      previewHtml: capture.dom?.previewHTML || "",
      cleanHtml: capture.dom?.cleanHtml || stripHtmlClassesAndStyles(capture.dom?.outerHTML || ""),
      rawHtml: capture.dom?.rawHtml || capture.dom?.outerHTML || ""
    },
    apiResolution: capture.apiResolution || null,
    api: (capture.network || []).map((item) => ({
      id: item.id,
      requestId: item.id,
      method: item.method,
      url: item.url,
      status: item.status,
      timestamp: item.timestamp,
      contentType: item.contentType,
      requestHeaders: item.requestHeaders || {},
      requestBody: item.requestBody || "",
      responseHeaders: item.responseHeaders || {},
      responseBody: item.responseBody || "",
      initiatorStack: item.initiatorStack || "",
      responsePreview: buildResponsePreview(item.responseBody, item.contentType)
    }))
  };
}

function renderOverview(bundle, recipe) {
  const section = document.createElement("section");
  section.className = "card overview";

  const header = document.createElement("div");
  header.className = "section-head";
  header.innerHTML = `
    <div>
      <h2>Предпросмотр DOM</h2>
      <p class="section-copy">Проверьте, что выбран именно тот блок, который хотите разобрать и экспортировать.</p>
    </div>
    <span class="pill">${escapeHtml(formatCapturedAt(bundle.capturedAt))}</span>
  `;

  const body = document.createElement("div");
  body.className = "overview-grid";

  const previewWrap = document.createElement("div");
  previewWrap.className = "preview-card";
  const hasPreview = bundle.dom?.previewHtml || bundle.dom?.cleanHtml;
  if (hasPreview) {
    previewWrap.appendChild(renderElementPreview(bundle.dom || {}, recipe));
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "HTML-превью недоступно.";
    previewWrap.appendChild(empty);
  }

  const apiCount = Array.isArray(bundle.api) && bundle.api.length
    ? bundle.api.length
    : Array.isArray(bundle.apiSchema)
      ? bundle.apiSchema.length
      : 0;
  const meta = document.createElement("div");
  meta.className = "meta-grid";
  meta.innerHTML = `
    ${renderMetric("Элемент", bundle.dom?.tagName || "—")}
    ${renderMetric("Селектор", bundle.dom?.selector || "—")}
    ${renderMetric("Текст", bundle.dom?.textPreview || "—")}
    ${renderMetric("API", String(apiCount))}
    ${renderMetric("Связи", String((recipe.bindings || recipe.dataRequirements || []).length || 0))}
  `;

  body.append(previewWrap, meta);
  section.append(header, body);
  return section;
}

function renderCaptureWarnings(capture) {
  const warnings = [];

  if (capture?.storageMeta?.fullCaptureAvailable === false) {
    warnings.push("Полный capture недоступен, поэтому Виджетрон показывает компактный fallback из storage.");
  }

  const hasTruncatedBodies = Boolean(
    capture?.storageMeta?.rawResponseBodiesTruncated ||
    (capture?.network || []).some((item) => (
      Boolean(item?.bodyTooLarge) ||
      String(item?.responseBody || "").includes("...[truncated]") ||
      String(item?.requestBody || "").includes("...[truncated]")
    ))
  );
  if (hasTruncatedBodies) {
    warnings.push("Часть request/response body была урезана на этапе захвата или fallback-хранения.");
  }

  const hasTruncatedDom = Boolean(
    String(capture?.dom?.innerText || "").includes("...[truncated]") ||
    String(capture?.dom?.outerHTML || "").includes("...[truncated]") ||
    String(capture?.dom?.previewHTML || "").includes("...[truncated]")
  );
  if (hasTruncatedDom) {
    warnings.push("DOM snapshot сохранён не полностью, поэтому итоговый экспорт может отличаться от исходного узла.");
  }

  if (!warnings.length) {
    return null;
  }

  const section = document.createElement("section");
  section.className = "card";
  section.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Ограничения capture</h2>
        <p class="section-copy">${escapeHtml(warnings.join(" "))}</p>
      </div>
    </div>
  `;
  return section;
}

function renderApiSection(bundle) {
  const schemaOnlyCount = Array.isArray(bundle.apiSchema) ? bundle.apiSchema.length : 0;
  const section = document.createElement("section");
  section.className = "card";

  const header = document.createElement("div");
  header.className = "section-head";
  header.innerHTML = `
    <div>
      <h2>Подключённые API</h2>
      <p class="section-copy">Это запросы, которые участвуют в объяснении выбранного виджета и его данных.</p>
    </div>
    <span class="count-badge">${escapeHtml(String(bundle.api?.length || schemaOnlyCount || 0))}</span>
  `;

  section.appendChild(header);

  if (!bundle.api?.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = schemaOnlyCount > 0
      ? "Для этого захвата сохранена только OpenAPI-типизация без сырых request/response body."
      : "API ещё не выбраны. Сейчас доступен только DOM.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "api-list";

  bundle.api.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "api-card";
    card.innerHTML = `
      <div class="api-card__top">
        <label class="api-pick">
          <input type="checkbox" class="api-select" data-api-id="${escapeHtml(item.id || item.requestId || String(index))}" checked />
          <span>${escapeHtml(item.method || "GET")} ${escapeHtml(shortenUrl(item.url || ""))}</span>
        </label>
        <span class="api-status">Статус ${escapeHtml(String(item.status || "?"))}</span>
      </div>
      <p class="api-copy">${escapeHtml(item.responsePreview || "Короткое превью ответа недоступно.")}</p>
      <details class="api-details">
        <summary>Тело и метаданные</summary>
        <div class="api-detail-grid">
          ${renderCodeBlock("Request body", item.requestBody || "—")}
          ${renderCodeBlock("Response body", item.responseBody || "—")}
        </div>
      </details>
    `;
    list.appendChild(card);
  });

  section.appendChild(list);
  return section;
}


function renderExportSection(bundle, recipe = {}) {
  const section = document.createElement("section");
  section.className = "card";

  const header = document.createElement("div");
  header.className = "section-head";
  header.innerHTML = `
    <div>
      <h2>Экспорт</h2>
      <p class="section-copy">Соберите нужный формат выгрузки и сразу проверьте итоговый payload.</p>
    </div>
  `;
  section.appendChild(header);

  const controls = document.createElement("div");
  controls.className = "export-controls";
  controls.innerHTML = `
    <label><input type="radio" name="export-scope" value="all" checked /> Всё вместе</label>
    <label><input type="radio" name="export-scope" value="api" /> API</label>
    <label><input type="radio" name="export-scope" value="api-types" /> OpenAPI schema</label>
    <label><input type="radio" name="export-scope" value="dom-clean" /> DOM clean</label>
    <label><input type="radio" name="export-scope" value="dom-raw" /> DOM raw</label>
  `;

  const actions = document.createElement("div");
  actions.className = "export-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Скопировать";

  const status = document.createElement("span");
  status.className = "export-status";

  const preview = document.createElement("pre");
  preview.className = "export-preview";

  const refresh = () => {
    const scope = section.querySelector("input[name='export-scope']:checked")?.value || "all";
    const selectedApiIds = getSelectedApiIds(bundle, stateEl);
    const payload = buildExportPayload(bundle, recipe, scope, selectedApiIds);
    preview.textContent = JSON.stringify(payload, null, 2);
    copyButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        status.textContent = "Скопировано.";
      } catch {
        status.textContent = "Не удалось скопировать.";
      }
    };
  };

  section.addEventListener("change", refresh);
  stateEl.onchange = () => refresh();

  actions.append(copyButton, status);
  section.append(controls, actions, preview);
  refresh();
  return section;
}

function getSelectedApiIds(bundle, root = document) {
  const allInputs = Array.from(root.querySelectorAll?.(".api-select") || []);
  if (!allInputs.length) {
    return new Set((bundle.api || bundle.apiSchema || []).map((item, index) => String(item.id || item.requestId || String(index))));
  }

  return new Set(
    allInputs
      .filter((input) => input.checked)
      .map((input) => input.dataset.apiId)
  );
}

function buildExportPayload(bundle, recipe, scope, selectedApiIds) {
  const selectedApi = (bundle.api || []).filter((item, index) => {
    const id = item.id || item.requestId || String(index);
    return selectedApiIds.has(id);
  });
  const selectedSchema = selectedApi.length > 0
    ? buildApiSchemaExport(selectedApi, recipe)
    : (bundle.apiSchema || []).filter((item, index) => {
      const id = item.id || item.requestId || String(index);
      return selectedApiIds.has(id);
    });

  const payload = {
    specVersion: bundle.specVersion || "widgetron.capture-bundle.v1",
    capturedAt: bundle.capturedAt || "",
    page: bundle.page || {}
  };
  if (bundle.apiResolution) {
    payload.apiResolution = bundle.apiResolution;
  }

  if (scope === "api") {
    payload.api = selectedApi;
    return payload;
  }

  if (scope === "api-types") {
    payload.apiSchema = selectedSchema;
    return payload;
  }

  if (scope === "dom-clean") {
    payload.dom = {
      tagName: bundle.dom?.tagName || "",
      selector: bundle.dom?.selector || "",
      textPreview: bundle.dom?.textPreview || "",
      cleanHtml: bundle.dom?.cleanHtml || ""
    };
    return payload;
  }

  if (scope === "dom-raw") {
    payload.dom = {
      tagName: bundle.dom?.tagName || "",
      selector: bundle.dom?.selector || "",
      textPreview: bundle.dom?.textPreview || "",
      rawHtml: bundle.dom?.rawHtml || ""
    };
    return payload;
  }

  payload.dom = {
    tagName: bundle.dom?.tagName || "",
    selector: bundle.dom?.selector || "",
    textPreview: bundle.dom?.textPreview || "",
    cleanHtml: bundle.dom?.cleanHtml || ""
  };
  payload.apiSchema = selectedSchema;
  return payload;
}

function buildApiSchemaExport(apiRecords, recipe = {}) {
  return (apiRecords || []).map((item, index) => ({
    id: item.id || item.requestId || `api-${index + 1}`,
    method: item.method || "GET",
    url: item.url || "",
    status: item.status || 0,
    contentType: item.contentType || "",
    responseSchema: getApiResponseSchema(item, recipe, index)
  }));
}

function getApiResponseSchema(request, recipe = {}, index = 0) {
  const requestId = request?.id || request?.requestId || `request-${index + 1}`;
  const recipeStep = (recipe.apiSequence || []).find((step) => (
    String(step?.requestId || "") === String(requestId)
  ));
  if (recipeStep?.response?.shape) {
    const parsed = parseJsonBody(request?.responseBody, request?.contentType);
    const rawBody = String(request?.responseBody || "").trim();
    const sampleValue = parsed !== null || rawBody === "null"
      ? parsed
      : undefined;
    return normalizeSchemaShape(recipeStep.response.shape, sampleValue, request?.contentType);
  }
  return extractResponseShape(request);
}

function renderMetric(label, value) {
  return `
    <article class="metric">
      <span class="metric__label">${escapeHtml(label)}</span>
      <div class="metric__value">${escapeHtml(value || "—")}</div>
    </article>
  `;
}

function renderCodeBlock(title, value) {
  return `
    <div class="code-card">
      <strong>${escapeHtml(title)}</strong>
      <pre>${escapeHtml(String(value || ""))}</pre>
    </div>
  `;
}

function getElementRecipe(capture) {
  if (capture?.cloneSpec) {
    return capture.cloneSpec;
  }

  if (capture?.elementRecipe) {
    return capture.elementRecipe;
  }

  const network = capture?.network || capture?.captureBundle?.api || [];
  return {
    version: 0,
    confidence: network.length > 0 ? "low" : "dom-only",
    element: {
      selector: capture?.dom?.selector || capture?.captureBundle?.dom?.selector || "",
      tagName: capture?.dom?.tagName || capture?.captureBundle?.dom?.tagName || "",
      textPreview: capture?.dom?.innerText || capture?.captureBundle?.dom?.textPreview || ""
    },
    domFacts: capture?.dom?.facts || [],
    responseFacts: [],
    bindings: [],
    renderEvidence: [],
    apiSequence: network.map((request, index) => ({
      requestId: request.id || request.requestId || `request-${index + 1}`,
      step: index + 1,
      method: request.method || "GET",
      url: request.url || "",
      status: request.status || 0,
      contentType: request.contentType || "",
      calledAt: request.timestamp ? new Date(Number(request.timestamp)).toISOString() : "",
      relativeToInteractionMs: null,
      response: {
        shape: extractResponseShape(request),
        matchedFields: []
      }
    })),
    apiDependencies: [],
    dataRequirements: [],
    sequence: []
  };
}

function findById(items = [], id) {
  return (items || []).find((item) => item.id === id) || null;
}

function formatConfidence(value) {
  const labels = {
    high: "Высокая",
    medium: "Средняя",
    low: "Низкая",
    "dom-only": "Только DOM"
  };
  return labels[value] || value || "—";
}

function formatConfidenceScore(value) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return `${Math.round(number * 100)}%`;
  }
  return formatConfidence(value);
}

function shortEndpoint(binding) {
  const endpoint = `${binding.method || ""} ${binding.url || ""}`.trim();
  if (!endpoint) {
    return "—";
  }
  return endpoint.length <= 96 ? endpoint : `${endpoint.slice(0, 93)}...`;
}

function formatReason(reason) {
  const labels = {
    "exact-text-match": "точный текст",
    "normalized-value-match": "нормализованное значение",
    "duration-number-match": "длительность к числу",
    "text-fragment-match": "фрагмент текста",
    "same-object-context": "контекст объекта",
    "response-key-context": "ключ ответа",
    "semantic-context-match": "семантический контекст",
    "post-response-mutation": "DOM обновился после ответа",
    "weak-numeric-match": "слабое числовое совпадение",
    "response-value-reused-in-request": "значение из ответа использовано в следующем запросе",
    "request-url-query": "совпало с query-параметром",
    "request-url-path": "совпало с path-сегментом",
    "request-body-json": "совпало с JSON body",
    "request-body-form": "совпало с form body",
    "request-body-text": "совпало с текстом body",
    "request-header": "совпало с request header",
    "request-key-context": "совпал контекст ключа запроса",
    "semantic-request-context": "семантика запроса совпала"
  };
  return labels[reason] || reason;
}

function formatStepTiming(step) {
  const parts = [];
  if (step.calledAt) {
    parts.push(new Date(step.calledAt).toLocaleString("ru-RU"));
  }
  if (Number.isFinite(Number(step.relativeToInteractionMs))) {
    parts.push(`${step.relativeToInteractionMs} ms от выбора`);
  }
  return parts.join(" В· ");
}

function renderElementPreview(dom = {}, recipe = {}) {
  const wrap = document.createElement("div");
  wrap.className = "preview-frame";

  const previewBindings = getPreviewBindings(recipe);
  wrap.appendChild(buildPreviewHighlightDom(dom.cleanHtml || dom.previewHtml || "", previewBindings));

  if (previewBindings.length > 0) {
    wrap.appendChild(renderPreviewMatchLegend(previewBindings));
  }

  if (!dom.previewHtml || dom.previewHtml === dom.cleanHtml) {
    return wrap;
  }

  const details = document.createElement("details");
  details.className = "preview-styled";

  const summary = document.createElement("summary");
  summary.textContent = "Стилизованное preview";

  const frame = document.createElement("iframe");
  frame.className = "element-preview";
  frame.setAttribute("sandbox", "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = buildPreviewDocument(dom.previewHtml);

  details.append(summary, frame);
  wrap.appendChild(details);
  return wrap;
}

function getPreviewBindings(recipe) {
  const bindings = recipe.bindings || recipe.dataRequirements || [];
  const seen = new Set();
  return bindings
    .filter((binding) => {
      const previewText = normalizeTextForPreview(binding.domValue || binding.value || "");
      if (!previewText) {
        return false;
      }
      const key = `${binding.domFactId || ""}:${previewText}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 12)
    .map((binding, index) => ({
      ...binding,
      previewIndex: index + 1,
      previewValue: String(binding.domValue || binding.value || ""),
      previewText: normalizeTextForPreview(binding.domValue || binding.value || "")
    }));
}

function buildPreviewHighlightDom(html, bindings) {
  const container = document.createElement("div");
  container.className = "clean-preview";

  if (!html) {
    return container;
  }

  if (!bindings.length) {
    container.innerHTML = html;
    return container;
  }

  try {
    const template = document.createElement("template");
    template.innerHTML = html;
    const remaining = new Map(bindings.map((binding) => [binding.previewIndex, binding]));
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);

    while (walker.nextNode() && remaining.size > 0) {
      const textNode = walker.currentNode;
      const source = textNode.textContent || "";
      const normalizedSource = normalizeTextForPreview(source);
      if (!normalizedSource) {
        continue;
      }

      const matched = Array.from(remaining.values()).find((binding) => normalizedSource.includes(binding.previewText));
      if (!matched) {
        continue;
      }

      const rawIndex = source.toLowerCase().indexOf(matched.previewValue.toLowerCase());
      if (rawIndex < 0) {
        continue;
      }

      const before = source.slice(0, rawIndex);
      const exact = source.slice(rawIndex, rawIndex + matched.previewValue.length);
      const after = source.slice(rawIndex + matched.previewValue.length);
      const fragment = document.createDocumentFragment();
      if (before) {
        fragment.appendChild(document.createTextNode(before));
      }

      const mark = document.createElement("mark");
      mark.className = "dom-match-mark";
      mark.dataset.matchIndex = String(matched.previewIndex);
      mark.title = `${matched.responsePath || matched.path || "JSON path"} вЂў ${shortEndpoint(matched)}`;
      mark.textContent = exact;
      fragment.appendChild(mark);

      if (after) {
        fragment.appendChild(document.createTextNode(after));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
      remaining.delete(matched.previewIndex);
    }

    container.appendChild(template.content.cloneNode(true));
    return container;
  } catch {
    container.innerHTML = html;
    return container;
  }
}

function renderPreviewMatchLegend(bindings) {
  const legend = document.createElement("div");
  legend.className = "dom-match-legend";

  const title = document.createElement("div");
  title.className = "dom-match-legend__title";
  title.textContent = "Связи в DOM preview";
  legend.appendChild(title);

  bindings.forEach((binding) => {
    const row = document.createElement("div");
    row.className = "dom-match-row";
    row.innerHTML = `
      <span class="dom-match-row__index">${escapeHtml(String(binding.previewIndex))}</span>
      <div class="dom-match-row__body">
        <strong>${escapeHtml(binding.previewValue || "—")}</strong>
        <small>${escapeHtml(binding.responsePath || binding.path || "—")}</small>
        <small>${escapeHtml(shortEndpoint(binding))}</small>
      </div>
      <span class="dom-match-row__score">${escapeHtml(formatConfidenceScore(binding.confidence))}</span>
    `;
    legend.appendChild(row);
  });

  return legend;
}

function normalizeTextForPreview(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildPreviewDocument(previewHtml) {
  return `<!doctype html>
  <html lang="ru">
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:;" />
      <style>
        html, body { margin: 0; padding: 0; background: #ffffff; color: #0f172a; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        body { padding: 12px; }
        .preview-root { min-height: 80px; }
      </style>
    </head>
    <body>
      <div class="preview-root">${previewHtml}</div>
    </body>
  </html>`;
}

function stripHtmlClassesAndStyles(html) {
  const text = String(html || "").trim();
  if (!text) {
    return "";
  }

  try {
    const template = document.createElement("template");
    template.innerHTML = text;
    template.content.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("style");
      node.removeAttribute("class");
      node.removeAttribute("part");
    });
    return template.innerHTML;
  } catch {
    return text.replace(/\s(?:style|class|part)=["'][^"']*["']/gi, "");
  }
}

function buildResponsePreview(responseBody, contentType) {
  const text = String(responseBody || "").trim();
  if (!text) {
    return "Пустой ответ";
  }

  if (String(contentType || "").toLowerCase().includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return `array[${parsed.length}]`;
      }
      if (parsed && typeof parsed === "object") {
        const keys = Object.keys(parsed).slice(0, 4);
        return `object: ${keys.join(", ")}`;
      }
    } catch {
      return shortenText(text, 140);
    }
  }

  return shortenText(text.replace(/\s+/g, " "), 140);
}

function extractResponseShape(request) {
  const parsed = parseJsonBody(request?.responseBody, request?.contentType);
  const rawBody = String(request?.responseBody || "").trim();
  if (parsed == null && rawBody !== "null") {
    return buildNonJsonResponseSchema(request);
  }

  return buildDataShape(parsed);
}

function buildNonJsonResponseSchema(request) {
  const body = request?.responseBody;
  const contentType = String(request?.contentType || "").trim().toLowerCase();
  if (!body) {
    return {};
  }

  const schema = {
    type: "string"
  };

  if (contentType) {
    schema.contentMediaType = contentType.split(";")[0];
  }

  const examples = collectSchemaExamples([body]);
  if (examples.length > 0) {
    schema.examples = examples;
  }

  return schema;
}

function normalizeSchemaShape(schema, sampleValue, contentType = "") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    if (sampleValue !== undefined) {
      return buildDataShape(sampleValue);
    }
    return {};
  }

  const normalized = { ...schema };

  if (normalized.nullable === true) {
    if (typeof normalized.type === "string" && normalized.type !== "null") {
      normalized.type = [normalized.type, "null"];
    } else if (!normalized.type) {
      normalized.type = "null";
    }
    delete normalized.nullable;
  }

  if (normalized.type === "text") {
    normalized.type = "string";
  }

  if (normalized.type === "empty") {
    delete normalized.type;
  }

  if (normalized.preview && !normalized.examples) {
    normalized.examples = collectSchemaExamples([normalized.preview]);
  }
  delete normalized.preview;

  if (normalized.type === "string" && !normalized.contentMediaType) {
    const mediaType = String(contentType || "").trim().toLowerCase().split(";")[0];
    if (mediaType && mediaType !== "application/json") {
      normalized.contentMediaType = mediaType;
    }
  }

  if (sampleValue === undefined) {
    return normalized;
  }

  if (sampleValue === null) {
    if (!normalized.examples) {
      normalized.examples = [null];
    }
    if (!normalized.type) {
      normalized.type = "null";
    }
    return normalized;
  }

  if (Array.isArray(sampleValue)) {
    if (!normalized.type) {
      normalized.type = "array";
    }
    delete normalized.examples;
    const firstMeaningfulItem = sampleValue.find((item) => item != null);
    if (normalized.items && firstMeaningfulItem !== undefined) {
      normalized.items = normalizeSchemaShape(normalized.items, firstMeaningfulItem);
    }
    return normalized;
  }

  if (sampleValue && typeof sampleValue === "object") {
    if (!normalized.type) {
      normalized.type = "object";
    }
    const keys = Object.keys(sampleValue).slice(0, MAX_OPENAPI_SCHEMA_PROPERTIES);
    delete normalized.examples;
    if (!normalized.properties) {
      normalized.properties = {};
    }
    for (const key of keys) {
      normalized.properties[key] = normalizeSchemaShape(
        normalized.properties[key] || {},
        sampleValue[key]
      );
    }
    return normalized;
  }

  if (!normalized.examples) {
    normalized.examples = collectSchemaExamples([sampleValue]);
  }
  if (!normalized.type) {
    normalized.type = Number.isInteger(sampleValue) ? "integer" : typeof sampleValue;
  }
  return normalized;
}

function parseJsonBody(body, contentType = "") {
  const text = String(body || "").trim();
  if (!text) {
    return null;
  }

  const looksLikeJson = String(contentType || "").toLowerCase().includes("application/json") ||
    text.startsWith("{") ||
    text.startsWith("[");
  if (!looksLikeJson) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildDataShape(value, depth = 0) {
  if (value === null) {
    return {
      type: "null",
      examples: [null]
    };
  }

  if (Array.isArray(value)) {
    const firstMeaningfulItem = value.find((item) => item != null);
    return {
      type: "array",
      items: depth >= MAX_OPENAPI_SCHEMA_DEPTH || firstMeaningfulItem == null ? {} : buildDataShape(firstMeaningfulItem, depth + 1)
    };
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).slice(0, MAX_OPENAPI_SCHEMA_PROPERTIES);
    if (depth >= MAX_OPENAPI_SCHEMA_DEPTH) {
      return {
        type: "object",
        properties: Object.fromEntries(keys.map((key) => [key, {}]))
      };
    }

    return {
      type: "object",
      properties: Object.fromEntries(keys.map((key) => [key, buildDataShape(value[key], depth + 1)]))
    };
  }

  return {
    type: Number.isInteger(value) ? "integer" : typeof value,
    examples: collectSchemaExamples([value])
  };
}

function collectSchemaExamples(values) {
  const unique = [];
  const seen = new Set();

  for (const value of values || []) {
    if (unique.length >= MAX_SCHEMA_EXAMPLES_PER_FIELD) {
      break;
    }
    const sanitized = sanitizeSchemaExample(value);
    if (sanitized === undefined) {
      continue;
    }
    const key = JSON.stringify(sanitized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(sanitized);
  }

  return unique;
}

function sanitizeSchemaExample(value) {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  if (looksLikeBase64Payload(text)) {
    return "base64";
  }

  if (text.length > 240 && /^[A-Za-z0-9+/=._:-]+$/.test(text)) {
    return "base64";
  }

  return shortenText(text, 240);
}

function looksLikeBase64Payload(value) {
  return /^data:[^;]+;base64,/i.test(value) || /^[A-Za-z0-9+/=\s]{160,}$/.test(value);
}

function formatCapturedAt(value) {
  if (!value) {
    return "Без даты";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function shortenUrl(url) {
  const text = String(url || "");
  if (text.length <= 92) {
    return text;
  }
  return `${text.slice(0, 89)}...`;
}

function shortenText(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}


