const stateEl = document.getElementById("state");
const jsonEl = document.getElementById("json");
const rawJsonPanelEl = document.querySelector(".debug-panel");
const LATEST_CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";
const CAPTURE_REF_MARK = "__vorovaykaCaptureRef";

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[LATEST_CAPTURE_STORAGE_KEY]?.newValue) {
    return;
  }

  void renderStoredCapture(changes[LATEST_CAPTURE_STORAGE_KEY].newValue, {
    removeLatest: true
  });
});

init();

async function init() {
  const stored = await chrome.storage.local.get([LATEST_CAPTURE_STORAGE_KEY, COPYABLE_CAPTURE_STORAGE_KEY]);
  if (stored[LATEST_CAPTURE_STORAGE_KEY]) {
    await renderStoredCapture(stored[LATEST_CAPTURE_STORAGE_KEY], {
      fallbackCapture: stored[COPYABLE_CAPTURE_STORAGE_KEY],
      removeLatest: true
    });
    return;
  }

  if (stored[COPYABLE_CAPTURE_STORAGE_KEY]) {
    renderCapture(stored[COPYABLE_CAPTURE_STORAGE_KEY]);
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
    if (fallbackCapture) {
      return fallbackCapture;
    }
    const key = value.storageKey || COPYABLE_CAPTURE_STORAGE_KEY;
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  return value || null;
}

function renderCapture(capture) {
  const bundle = normalizeCaptureBundle(capture);
  stateEl.innerHTML = "";

  if (!bundle) {
    stateEl.innerHTML = "<section class=\"card\"><p>Не удалось прочитать сохранённый захват.</p></section>";
    return;
  }

  const root = document.createElement("div");
  root.className = "viewer-grid";
  root.append(
    renderOverview(bundle),
    renderApiSection(bundle),
    renderExportSection(bundle)
  );

  stateEl.appendChild(root);
  if (rawJsonPanelEl) {
    rawJsonPanelEl.open = false;
  }
  jsonEl.textContent = JSON.stringify(capture, null, 2);
}

function normalizeCaptureBundle(capture) {
  if (capture?.captureBundle) {
    return capture.captureBundle;
  }

  if (!capture) {
    return null;
  }

  return {
    specVersion: "vorovayka.capture-bundle.v1",
    capturedAt: capture.createdAt || "",
    page: {
      title: capture.page?.title || "",
      url: capture.page?.url || ""
    },
    selection: {
      type: capture.interaction?.type || "",
      timestamp: capture.interaction?.timestamp || 0
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

function renderOverview(bundle) {
  const section = document.createElement("section");
  section.className = "card overview";

  const header = document.createElement("div");
  header.className = "section-head";
  header.innerHTML = `
    <div>
      <h2>DOM preview</h2>
      <p class="section-copy">Проверьте, что выбран именно тот узел.</p>
    </div>
    <span class="pill">${escapeHtml(formatCapturedAt(bundle.capturedAt))}</span>
  `;

  const body = document.createElement("div");
  body.className = "overview-grid";

  const previewWrap = document.createElement("div");
  previewWrap.className = "preview-card";
  if (bundle.dom?.previewHtml) {
    previewWrap.appendChild(renderElementPreview(bundle.dom.previewHtml));
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "HTML-превью недоступно.";
    previewWrap.appendChild(empty);
  }

  const meta = document.createElement("div");
  meta.className = "meta-grid";
  meta.innerHTML = `
    ${renderMetric("Элемент", bundle.dom?.tagName || "—")}
    ${renderMetric("Селектор", bundle.dom?.selector || "—")}
    ${renderMetric("Текст", bundle.dom?.textPreview || "—")}
    ${renderMetric("API", String(bundle.api?.length || 0))}
  `;

  body.append(previewWrap, meta);
  section.append(header, body);
  return section;
}

function renderApiSection(bundle) {
  const section = document.createElement("section");
  section.className = "card";

  const header = document.createElement("div");
  header.className = "section-head";
  header.innerHTML = `
    <div>
      <h2>Выбранные API</h2>
      <p class="section-copy">Это запросы, которые были отмечены на предыдущем шаге.</p>
    </div>
    <span class="count-badge">${escapeHtml(String(bundle.api?.length || 0))}</span>
  `;

  section.appendChild(header);

  if (!bundle.api?.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "API не выбраны. Доступен только DOM.";
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
        <span class="api-status">Status ${escapeHtml(String(item.status || "?"))}</span>
      </div>
      <p class="api-copy">${escapeHtml(item.responsePreview || "Preview ответа недоступен.")}</p>
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

function renderExportSection(bundle) {
  const section = document.createElement("section");
  section.className = "card";

  const header = document.createElement("div");
  header.className = "section-head";
  header.innerHTML = `
    <div>
      <h2>Экспорт</h2>
      <p class="section-copy">Выберите, что именно нужно выгрузить и скопировать.</p>
    </div>
  `;
  section.appendChild(header);

  const controls = document.createElement("div");
  controls.className = "export-controls";
  controls.innerHTML = `
    <label><input type="radio" name="export-scope" value="all" checked /> Всё вместе</label>
    <label><input type="radio" name="export-scope" value="api" /> API</label>
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
    const selectedApiIds = new Set(
      Array.from(document.querySelectorAll(".api-select:checked"))
        .map((input) => input.dataset.apiId)
    );
    const payload = buildExportPayload(bundle, scope, selectedApiIds);
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

function buildExportPayload(bundle, scope, selectedApiIds) {
  const selectedApi = (bundle.api || []).filter((item, index) => {
    const id = item.id || item.requestId || String(index);
    return selectedApiIds.has(id);
  });

  const payload = {
    specVersion: bundle.specVersion || "vorovayka.capture-bundle.v1",
    capturedAt: bundle.capturedAt || "",
    page: bundle.page || {}
  };

  if (scope === "api") {
    payload.api = selectedApi;
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
    cleanHtml: bundle.dom?.cleanHtml || "",
    rawHtml: bundle.dom?.rawHtml || ""
  };
  payload.api = selectedApi;
  return payload;
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

function renderElementPreview(previewHtml) {
  const wrap = document.createElement("div");
  wrap.className = "preview-frame";

  const frame = document.createElement("iframe");
  frame.className = "element-preview";
  frame.setAttribute("sandbox", "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = buildPreviewDocument(previewHtml);

  wrap.appendChild(frame);
  return wrap;
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
