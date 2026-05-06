const stateEl = document.getElementById("state");
const jsonEl = document.getElementById("json");
const rawJsonPanelEl = document.querySelector(".debug-panel");
const LATEST_CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[LATEST_CAPTURE_STORAGE_KEY]?.newValue) {
    return;
  }

  renderCapture(changes[LATEST_CAPTURE_STORAGE_KEY].newValue);
  void chrome.storage.local.remove(LATEST_CAPTURE_STORAGE_KEY);
});

init();

async function init() {
  const stored = await chrome.storage.local.get([LATEST_CAPTURE_STORAGE_KEY, COPYABLE_CAPTURE_STORAGE_KEY]);
  if (stored[LATEST_CAPTURE_STORAGE_KEY]) {
    renderCapture(stored[LATEST_CAPTURE_STORAGE_KEY]);
    await chrome.storage.local.remove(LATEST_CAPTURE_STORAGE_KEY);
    return;
  }

  if (stored[COPYABLE_CAPTURE_STORAGE_KEY]) {
    renderCapture(stored[COPYABLE_CAPTURE_STORAGE_KEY]);
  }
}

function renderCapture(capture) {
  stateEl.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "grid";

  const recipe = getElementRecipe(capture);
  wrapper.appendChild(renderMeta(capture));
  wrapper.appendChild(renderRecipe(recipe));
  wrapper.appendChild(renderExportPanel(capture, recipe));
  wrapper.appendChild(renderDom(capture.dom));
  wrapper.appendChild(renderRequests(capture.network || []));

  stateEl.appendChild(wrapper);
  if (rawJsonPanelEl) {
    rawJsonPanelEl.open = false;
  }
  jsonEl.textContent = JSON.stringify(capture, null, 2);
}

function renderMeta(capture) {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <div class="pill">Получено ${escapeHtml(capture.createdAt || "")}</div>
    <div class="meta-grid">
      <article class="metric">
        <span class="metric__label">Страница</span>
        <div class="metric__value">${escapeHtml(capture.page?.title || "Без заголовка")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Адрес</span>
        <div class="metric__value">${escapeHtml(capture.page?.url || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Событие</span>
        <div class="metric__value">${escapeHtml(capture.interaction?.type || "—")} · ${escapeHtml(formatTimestamp(capture.interaction?.timestamp))}</div>
      </article>
    </div>
  `;
  return section;
}

function renderExportPanel(capture, recipe) {
  const section = document.createElement("section");
  section.className = "grid export-panel";

  const bindings = getExportBindings(recipe).slice(0, 40);
  section.innerHTML = `
    <h2 class="section-title">Выгрузка JSON</h2>
    <p class="section-copy">Минимальный payload: порядок API-вызовов, URL API и JSON-path данных, которые нужны для отображения.</p>
  `;

  const minimalNote = document.createElement("div");
  minimalNote.className = "export-note";
  minimalNote.textContent = "По умолчанию выгружается только API-рецепт. Структура ответа, request body/headers, DOM и debug добавляются вручную.";

  const options = document.createElement("div");
  options.className = "export-options";
  [
    ["apiRecipe", "Минимум: API URL + JSON-path", true],
    ["widget", "Опционально: виджет и превью", false],
    ["requestDetails", "Опционально: request body/headers", false],
    ["responseShape", "Опционально: структура ответа", false],
    ["dataModel", "Модель данных", false],
    ["apiCalls", "Debug: API-вызовы", false],
    ["apiDependencies", "Debug: зависимости API", false],
    ["domContext", "Debug: DOM-контекст", false],
    ["alternatives", "Альтернативные источники", false],
    ["rawResponses", "Debug: сырые ответы", false],
    ["rawCapture", "Debug: полный capture", false]
  ].forEach(([id, label, checked]) => {
    const item = document.createElement("label");
    item.className = "export-check";
    item.innerHTML = `
      <input type="checkbox" data-export-option="${escapeHtml(id)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    `;
    options.appendChild(item);
  });

  const fields = document.createElement("div");
  fields.className = "export-fields";
  fields.innerHTML = "<strong>Поля объекта</strong>";

  if (bindings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Для экспорта пока нет найденных DOM ↔ API полей.";
    fields.appendChild(empty);
  } else {
    bindings.forEach((binding, index) => {
      const fieldId = getBindingExportId(binding, index);
      const item = document.createElement("label");
      item.className = "export-field";
      item.innerHTML = `
        <input type="checkbox" class="export-field__input" value="${escapeHtml(fieldId)}" checked />
        <span>
          <strong>${escapeHtml(deriveExportFieldName(binding, index))}</strong>
          <small>${escapeHtml(inferExportFieldType(binding))} · ${escapeHtml(binding.responsePath || binding.path || "")}</small>
        </span>
      `;
      fields.appendChild(item);
    });
  }

  const actions = document.createElement("div");
  actions.className = "export-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Скопировать JSON";

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.textContent = "Скачать .json";

  const status = document.createElement("span");
  status.className = "export-status";

  const preview = renderCodeBlock("Предпросмотр export JSON", "", {
    collapsed: true,
    summary: "Подробнее: JSON выгрузки",
    debug: true
  });
  const previewPre = preview.querySelector("pre");

  const refreshPreview = () => {
    const payload = buildExportPayload(capture, recipe, collectExportOptions(section));
    previewPre.textContent = JSON.stringify(payload, null, 2);
  };

  section.addEventListener("change", refreshPreview);
  copyButton.addEventListener("click", async () => {
    const text = JSON.stringify(buildExportPayload(capture, recipe, collectExportOptions(section)), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "JSON скопирован.";
    } catch {
      status.textContent = "Не удалось скопировать JSON.";
    }
  });
  downloadButton.addEventListener("click", () => {
    const text = JSON.stringify(buildExportPayload(capture, recipe, collectExportOptions(section)), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `vorovayka-export-${Date.now()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Файл подготовлен.";
  });

  actions.append(copyButton, downloadButton, status);
  section.append(minimalNote, options, fields, actions, preview);
  refreshPreview();
  return section;
}

function collectExportOptions(root) {
  const isChecked = (id) => Boolean(root.querySelector(`[data-export-option="${id}"]`)?.checked);
  return {
    apiRecipe: isChecked("apiRecipe"),
    widget: isChecked("widget"),
    requestDetails: isChecked("requestDetails"),
    responseShape: isChecked("responseShape"),
    dataModel: isChecked("dataModel"),
    apiCalls: isChecked("apiCalls"),
    apiDependencies: isChecked("apiDependencies"),
    domContext: isChecked("domContext"),
    alternatives: isChecked("alternatives"),
    rawResponses: isChecked("rawResponses"),
    rawCapture: isChecked("rawCapture"),
    selectedFieldIds: new Set(
      Array.from(root.querySelectorAll(".export-field__input:checked"))
        .map((input) => input.value)
    )
  };
}

function buildExportPayload(capture, recipe, options) {
  const selectedBindings = getSelectedExportBindings(recipe, options.selectedFieldIds);
  const payload = {
    specVersion: "vorovayka.render-export.v1",
    exportedAt: new Date().toISOString(),
    source: {
      capturedAt: capture.createdAt || "",
      pageUrl: capture.page?.url || "",
      pageTitle: capture.page?.title || "",
      confidence: recipe.confidence || ""
    }
  };

  if (options.apiRecipe) {
    payload.apiRecipe = buildExportApiRecipe(recipe, selectedBindings, options);
  }

  if (options.widget) {
    payload.widget = buildExportWidget(capture, recipe);
  }

  if (options.dataModel) {
    payload.dataModel = buildExportDataModel(recipe, selectedBindings, options);
  }

  if (options.apiCalls) {
    payload.apiCalls = buildExportApiCalls(recipe, selectedBindings, options);
  }

  if (options.apiDependencies) {
    payload.apiDependencies = getApiDependencies(recipe);
  }

  if (options.domContext) {
    payload.domContext = {
      selector: capture.dom?.selector || recipe.element?.selector || "",
      tagName: capture.dom?.tagName || recipe.element?.tagName || "",
      rect: capture.dom?.rect || recipe.element?.rect || {},
      textFragments: capture.dom?.textFragments || recipe.element?.textFragments || [],
      attributes: capture.dom?.attributes || recipe.element?.attributes || {},
      ancestorChain: capture.dom?.ancestorChain || recipe.element?.ancestorChain || []
    };
  }

  const debug = {};
  if (options.rawResponses) {
    debug.rawResponses = (capture.network || []).map((request) => ({
      id: request.id || "",
      method: request.method || "GET",
      url: request.url || "",
      status: request.status || 0,
      contentType: request.contentType || "",
      requestBody: request.requestBody || "",
      responseBody: request.responseBody || ""
    }));
  }
  if (options.rawCapture) {
    debug.capture = capture;
  }
  if (Object.keys(debug).length > 0) {
    payload.debug = debug;
  }

  return payload;
}

function buildExportApiRecipe(recipe, bindings, options) {
  const dependencies = getApiDependencies(recipe).map(formatExportApiDependency);
  const requiredData = buildExportRequiredData(recipe, bindings, options);
  const calls = buildExportApiCalls(recipe, bindings, { ...options, rawResponses: false })
    .map(({ fields, ...call }) => ({
      ...call,
      providesData: fields
    }));
  const minimalDataMap = buildMinimalApiDataMap(calls, requiredData);

  return {
    version: 1,
    exportMode: "minimal-api-data-map",
    summary: {
      callsCount: calls.length,
      requiredDataCount: requiredData.length,
      dependencyEdgesCount: dependencies.length,
      confidence: recipe.confidence || "",
      includesResponseShape: Boolean(options.responseShape),
      includesRequestDetails: Boolean(options.requestDetails)
    },
    minimalDataMap,
    sequence: buildExportCallSequence(recipe, dependencies),
    calls,
    requiredData,
    dependencies
  };
}

function buildExportRequiredData(recipe, bindings, options) {
  const usedNames = new Map();

  return bindings.map((binding, index) => {
    const name = makeUniqueExportName(deriveExportFieldName(binding, index), usedNames);
    const jsonPath = binding.responsePath || binding.path || "";
    const alternatives = options.alternatives
      ? getBindingAlternatives(recipe, binding).slice(0, 5).map(bindingToExportAlternative)
      : [];

    return {
      fieldId: getBindingExportId(binding, index),
      name,
      description: describeExportField(binding, name),
      type: inferExportFieldType(binding),
      displayValue: binding.domValue || binding.value || "",
      valueExample: binding.responseValue || binding.value || "",
      readFrom: {
        requestId: binding.requestId || "",
        callOrder: binding.step || null,
        method: binding.method || "GET",
        url: binding.url || "",
        jsonPath,
        responseKey: binding.responseKey || "",
        parentObjectPath: binding.parentObjectPath || ""
      },
      confidence: binding.confidence || null,
      reasons: binding.reasons || [],
      alternatives
    };
  });
}

function buildMinimalApiDataMap(calls, requiredData) {
  const byRequestId = new Map(calls.map((call) => [call.requestId, call]));
  const byApi = new Map();

  requiredData.forEach((field) => {
    const call = byRequestId.get(field.readFrom?.requestId) || {};
    const key = `${field.readFrom?.method || call.method || "GET"} ${field.readFrom?.url || call.url || ""}`;
    const current = byApi.get(key) || {
      requestId: field.readFrom?.requestId || call.requestId || "",
      order: field.readFrom?.callOrder || call.step || null,
      method: field.readFrom?.method || call.method || "GET",
      url: field.readFrom?.url || call.url || "",
      dataPaths: []
    };

    current.dataPaths.push({
      fieldId: field.fieldId,
      name: field.name,
      type: field.type,
      jsonPath: field.readFrom?.jsonPath || "",
      valueExample: field.valueExample || field.displayValue || "",
      description: field.description || ""
    });
    byApi.set(key, current);
  });

  return Array.from(byApi.values())
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function buildExportCallSequence(recipe, dependencies = []) {
  const dependenciesByTarget = new Map();
  dependencies.forEach((dependency) => {
    const list = dependenciesByTarget.get(dependency.toRequestId) || [];
    list.push({
      fromRequestId: dependency.fromRequestId,
      fromOrder: dependency.fromOrder,
      sourceJsonPath: dependency.sourceJsonPath,
      target: dependency.target,
      valueExample: dependency.valueExample
    });
    dependenciesByTarget.set(dependency.toRequestId, list);
  });

  return (recipe.apiSequence || []).map((step) => ({
    order: step.step || null,
    requestId: step.requestId || "",
    method: step.method || "GET",
    url: step.url || "",
    dependsOn: dependenciesByTarget.get(step.requestId) || []
  }));
}

function formatExportApiDependency(edge) {
  return {
    fromRequestId: edge.fromRequestId || "",
    fromOrder: edge.fromStep || null,
    fromLabel: edge.fromLabel || "",
    toRequestId: edge.toRequestId || "",
    toOrder: edge.toStep || null,
    toLabel: edge.toLabel || "",
    sourceJsonPath: edge.source?.path || edge.sourcePath || "",
    sourceKey: edge.source?.key || "",
    target: {
      location: edge.target?.location || "",
      path: edge.target?.path || edge.target?.key || ""
    },
    valueExample: edge.value || "",
    confidence: edge.confidence || null,
    reasons: edge.reasons || []
  };
}

function buildExportWidget(capture, recipe) {
  return {
    selector: recipe.element?.selector || capture.dom?.selector || "",
    tagName: recipe.element?.tagName || capture.dom?.tagName || "",
    role: recipe.element?.role || capture.dom?.role || "",
    textPreview: recipe.element?.textPreview || capture.dom?.innerText || "",
    rect: recipe.element?.rect || capture.dom?.rect || {},
    previewHTML: capture.dom?.previewHTML || "",
    renderHint: {
      usePreviewHTML: Boolean(capture.dom?.previewHTML),
      styles: "computed-inline"
    }
  };
}

function buildExportDataModel(recipe, bindings, options) {
  const usedNames = new Map();
  const fields = bindings.map((binding, index) => {
    const name = makeUniqueExportName(deriveExportFieldName(binding, index), usedNames);
    const alternatives = options.alternatives
      ? getBindingAlternatives(recipe, binding).slice(0, 5).map(bindingToExportAlternative)
      : [];

    return {
      id: getBindingExportId(binding, index),
      name,
      type: inferExportFieldType(binding),
      displayValue: binding.domValue || binding.value || "",
      valueExample: binding.responseValue || binding.value || "",
      source: {
        requestId: binding.requestId || "",
        step: binding.step || null,
        method: binding.method || "GET",
        url: binding.url || "",
        jsonPath: binding.responsePath || binding.path || "",
        responseKey: binding.responseKey || "",
        parentObjectPath: binding.parentObjectPath || "",
        confidence: binding.confidence || null,
        reasons: binding.reasons || []
      },
      dom: {
        selector: binding.dom?.selector || "",
        value: binding.domValue || binding.value || ""
      },
      alternatives
    };
  });

  return {
    objectType: "CapturedWidgetData",
    fields,
    schema: Object.fromEntries(fields.map((field) => [
      field.name,
      {
        type: field.type,
        sourcePath: field.source.jsonPath,
        endpoint: field.source.url,
        required: true
      }
    ]))
  };
}

function buildExportApiCalls(recipe, bindings, options) {
  const allBindings = getExportBindings(recipe);
  const bindingsByRequest = new Map();
  bindings.forEach((binding) => {
    const list = bindingsByRequest.get(binding.requestId) || [];
    list.push(binding);
    bindingsByRequest.set(binding.requestId, list);
  });

  return (recipe.apiSequence || []).map((step) => {
    const call = {
      requestId: step.requestId || "",
      step: step.step || null,
      method: step.method || "GET",
      url: step.url || "",
      fields: (bindingsByRequest.get(step.requestId) || []).map((binding, index) => {
        const globalIndex = Math.max(0, allBindings.indexOf(binding));
        return {
          fieldId: getBindingExportId(binding, globalIndex || index),
          name: deriveExportFieldName(binding, globalIndex || index),
          jsonPath: binding.responsePath || binding.path || "",
          valueExample: binding.responseValue || binding.value || ""
        };
      })
    };

    if (options.requestDetails) {
      call.request = {
        body: step.request?.body || "",
        headers: step.request?.headers || {}
      };
      call.status = step.status || 0;
      call.contentType = step.contentType || "";
    }

    if (options.responseShape) {
      call.responseShape = step.response?.shape || {};
    }

    if (options.rawResponses) {
      call.responsePreview = step.response?.bodyPreview || "";
    }

    return call;
  });
}

function getExportBindings(recipe) {
  return (recipe.bindings || recipe.dataRequirements || []);
}

function getSelectedExportBindings(recipe, selectedFieldIds) {
  const bindings = getExportBindings(recipe);
  if (!selectedFieldIds || selectedFieldIds.size === 0) {
    return [];
  }

  return bindings.filter((binding, index) => selectedFieldIds.has(getBindingExportId(binding, index)));
}

function getBindingExportId(binding, index) {
  return binding.id || binding.bindingId || `field-${index + 1}`;
}

function deriveExportFieldName(binding, index) {
  const raw = binding.responseKey ||
    String(binding.responsePath || binding.path || "").split(".").pop()?.replace(/\[\d+\]/g, "") ||
    `field_${index + 1}`;
  const normalized = String(raw || `field_${index + 1}`)
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `field_${index + 1}`;
}

function makeUniqueExportName(name, usedNames) {
  const count = usedNames.get(name) || 0;
  usedNames.set(name, count + 1);
  return count === 0 ? name : `${name}_${count + 1}`;
}

function describeExportField(binding, name) {
  const displayValue = binding.domValue || binding.value || "";
  const responseValue = binding.responseValue || binding.value || "";
  const path = binding.responsePath || binding.path || "";
  const parts = [`Данные для поля ${name}`];

  if (displayValue) {
    parts.push(`видимое значение: ${displayValue}`);
  }
  if (responseValue && responseValue !== displayValue) {
    parts.push(`пример из API: ${responseValue}`);
  }
  if (path) {
    parts.push(`читать из ${path}`);
  }

  return parts.join("; ");
}

function inferExportFieldType(binding) {
  if (binding.kind === "duration") {
    return "duration";
  }
  if (["number", "currency", "percent"].includes(binding.kind)) {
    return binding.kind;
  }
  if (binding.kind === "date") {
    return "date";
  }

  const value = binding.responseValue || binding.domValue || binding.value || "";
  if (/^-?\d+(?:\.\d+)?$/.test(String(value))) {
    return "number";
  }
  return "string";
}

function bindingToExportAlternative(binding) {
  return {
    requestId: binding.requestId || "",
    step: binding.step || null,
    method: binding.method || "GET",
    url: binding.url || "",
    jsonPath: binding.responsePath || binding.path || "",
    valueExample: binding.responseValue || binding.value || "",
    confidence: binding.confidence || null,
    reasons: binding.reasons || []
  };
}

function renderRecipe(recipe) {
  const section = document.createElement("section");
  section.className = "grid";

  const bindings = recipe.bindings || recipe.dataRequirements || [];
  const matchesCount = bindings.length;
  const steps = recipe.apiSequence || [];
  const apiDependencies = getApiDependencies(recipe);

  section.innerHTML = `
    <h2 class="section-title">API-рецепт элемента</h2>
    <div class="meta-grid">
      <article class="metric">
        <span class="metric__label">Селектор</span>
        <div class="metric__value">${escapeHtml(recipe.element?.selector || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Уверенность</span>
        <div class="metric__value">${escapeHtml(formatConfidence(recipe.confidence))}</div>
      </article>
      <article class="metric">
        <span class="metric__label">API-вызовы</span>
        <div class="metric__value">${steps.length}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Поля данных</span>
        <div class="metric__value">${matchesCount}</div>
      </article>
    </div>
  `;

  if (bindings.length > 0) {
    section.appendChild(renderBindingExplorer(recipe));
  }

  if (steps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Для элемента сохранён только DOM-контекст.";
    section.appendChild(empty);
    return section;
  }

  const sequence = document.createElement("div");
  sequence.className = "timeline";
  if (apiDependencies.length > 0) {
    section.appendChild(renderSequenceDiagram(apiDependencies));
  }
  steps.forEach((step) => {
    sequence.appendChild(renderApiStep(step));
  });
  section.appendChild(sequence);

  return section;
}

function renderBindingExplorer(recipe) {
  const surface = document.createElement("div");
  surface.className = "surface binding-explorer";

  const title = document.createElement("strong");
  title.textContent = "Карта значений";

  const layout = document.createElement("div");
  layout.className = "binding-layout";

  const list = document.createElement("div");
  list.className = "binding-list";

  const panel = document.createElement("div");
  panel.className = "binding-detail";

  const bindings = (recipe.bindings || recipe.dataRequirements || []).slice(0, 40);
  bindings.forEach((binding, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `binding-chip${index === 0 ? " binding-chip--active" : ""}`;
    button.innerHTML = `
      <span>${escapeHtml(binding.domValue || binding.value || "")}</span>
      <small>${escapeHtml(formatConfidenceScore(binding.confidence))} · ${escapeHtml(binding.responsePath || binding.path || "")}</small>
      <small>${escapeHtml(shortEndpoint(binding))}</small>
    `;
    button.addEventListener("click", () => {
      list.querySelectorAll(".binding-chip--active").forEach((active) => {
        active.classList.remove("binding-chip--active");
      });
      button.classList.add("binding-chip--active");
      renderBindingDetail(panel, binding, recipe);
    });
    list.appendChild(button);
  });

  layout.append(list, panel);
  surface.append(title, layout);

  if (bindings[0]) {
    renderBindingDetail(panel, bindings[0], recipe);
  }

  return surface;
}

function renderBindingDetail(panel, binding, recipe) {
  const domFact = findById(recipe.domFacts, binding.domFactId);
  const responseFact = findById(recipe.responseFacts, binding.responseFactId);
  const evidence = binding.evidence || [];
  const reasons = binding.reasons || [];
  const endpoint = `${binding.method || ""} ${binding.url || ""}`.trim();
  const alternatives = getBindingAlternatives(recipe, binding);

  panel.innerHTML = `
    <div class="binding-detail__headline">
      <span>${escapeHtml(binding.domValue || binding.value || "")}</span>
      <strong>${escapeHtml(formatConfidenceScore(binding.confidence))}</strong>
    </div>
    <div class="detail-grid">
      <div>
        <span class="metric__label">Backend</span>
        <div class="metric__value">${escapeHtml(endpoint || "—")}</div>
      </div>
      <div>
        <span class="metric__label">JSON path</span>
        <div class="metric__value">${escapeHtml(binding.responsePath || binding.path || "—")}</div>
      </div>
      <div>
        <span class="metric__label">DOM selector</span>
        <div class="metric__value">${escapeHtml(binding.dom?.selector || domFact?.selector || "—")}</div>
      </div>
      <div>
        <span class="metric__label">Response key</span>
        <div class="metric__value">${escapeHtml(binding.responseKey || responseFact?.key || "—")}</div>
      </div>
    </div>
    <div class="reason-list">
      ${reasons.map((reason) => `<span>${escapeHtml(formatReason(reason))}</span>`).join("")}
    </div>
    <div class="surface surface--code">
      <strong>DOM context</strong>
      <pre>${escapeHtml(JSON.stringify(binding.dom?.context || domFact?.context || {}, null, 2))}</pre>
    </div>
    <div class="surface surface--code">
      <strong>Sibling fields</strong>
      <pre>${escapeHtml(JSON.stringify(binding.response?.siblingFields || responseFact?.siblingFields || {}, null, 2))}</pre>
    </div>
  `;

  if (evidence.length > 0) {
    panel.appendChild(renderCodeBlock("Render evidence", JSON.stringify(evidence, null, 2), {
      collapsed: true,
      summary: "Подробнее: render evidence"
    }));
  }

  if (alternatives.length > 0) {
    panel.appendChild(renderAlternatives(alternatives));
  }
}

function renderAlternatives(alternatives) {
  const surface = document.createElement("div");
  surface.className = "surface alternative-list";
  surface.innerHTML = "<strong>Альтернативные API для этого значения</strong>";

  alternatives.slice(0, 6).forEach((binding) => {
    const item = document.createElement("div");
    item.className = "alternative-row";
    item.innerHTML = `
      <span>${escapeHtml(formatConfidenceScore(binding.confidence))}</span>
      <strong>${escapeHtml(shortEndpoint(binding))}</strong>
      <small>${escapeHtml(binding.responsePath || binding.path || "")}</small>
      <small>${escapeHtml((binding.reasons || []).map(formatReason).join(", "))}</small>
    `;
    surface.appendChild(item);
  });

  return surface;
}

function getBindingAlternatives(recipe, binding) {
  return (recipe.bindings || recipe.dataRequirements || [])
    .filter((item) => (
      item !== binding &&
      item.domFactId === binding.domFactId &&
      (item.requestId !== binding.requestId || item.responsePath !== binding.responsePath)
    ))
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function renderSequenceDiagram(sequence) {
  const surface = document.createElement("div");
  surface.className = "surface sequence-diagram";

  const title = document.createElement("strong");
  title.textContent = "Sequence зависимостей API";
  surface.appendChild(title);

  const rows = document.createElement("div");
  rows.className = "sequence-rows";
  (sequence || []).forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "sequence-row";
    row.innerHTML = `
      <span class="sequence-row__index">${escapeHtml(String(index + 1))}</span>
      <span class="sequence-node">
        <small>Ответ #${escapeHtml(String(item.fromStep || ""))}</small>
        <strong>${escapeHtml(item.fromLabel || item.fromRequestId || "API")}</strong>
      </span>
      <span class="sequence-row__arrow">→</span>
      <span class="sequence-node">
        <small>Запрос #${escapeHtml(String(item.toStep || ""))}</small>
        <strong>${escapeHtml(item.toLabel || item.toRequestId || "API")}</strong>
      </span>
      <span class="sequence-row__label">
        <strong>${escapeHtml(formatDependencySource(item))} → ${escapeHtml(formatDependencyTarget(item.target))}</strong>
        <small>${escapeHtml(formatDependencyMeta(item))}</small>
      </span>
      <strong class="sequence-row__confidence">${escapeHtml(formatConfidenceScore(item.confidence))}</strong>
    `;
    rows.appendChild(row);
  });

  surface.appendChild(rows);
  return surface;
}

function getApiDependencies(recipe) {
  const direct = (recipe.apiDependencies || []).filter(isApiDependency);
  if (direct.length > 0) {
    return direct;
  }

  return (recipe.sequence || []).filter(isApiDependency);
}

function isApiDependency(item) {
  return Boolean(item?.fromRequestId && item?.toRequestId && item?.source && item?.target);
}

function formatDependencySource(item) {
  return item.source?.path || item.sourcePath || "response";
}

function formatDependencyTarget(target = {}) {
  const labels = {
    url: "URL",
    body: "Request body",
    headers: "Header"
  };
  const location = labels[target.location] || target.location || "request";
  const path = target.path || target.key || "";
  return path ? `${location}: ${path}` : location;
}

function formatDependencyMeta(item) {
  const parts = [];
  if (item.value) {
    parts.push(`значение: ${item.value}`);
  }
  if (item.reasons?.length) {
    parts.push(item.reasons.map(formatReason).join(", "));
  }
  return parts.join(" · ");
}

function renderDataRequirements(requirements = []) {
  const surface = document.createElement("div");
  surface.className = "surface";

  const title = document.createElement("strong");
  title.textContent = "Данные, найденные в выбранном элементе";
  surface.appendChild(title);

  const list = document.createElement("div");
  list.className = "match-list";
  requirements.slice(0, 16).forEach((item) => {
    const row = document.createElement("div");
    row.className = "match-row";
    row.innerHTML = `
      <span class="match-row__path">#${escapeHtml(String(item.step || ""))} ${escapeHtml(item.path || "")}</span>
      <span class="match-row__value">${escapeHtml(item.value || "")}</span>
    `;
    list.appendChild(row);
  });

  surface.appendChild(list);
  return surface;
}

function renderApiStep(step) {
  const card = document.createElement("article");
  card.className = "request request--step";

  const matchedFields = step.response?.matchedFields || [];
  const requestBody = step.request?.body || "";
  const initiatorStack = step.request?.initiatorStack || "";

  card.innerHTML = `
    <div class="request__header">
      <div>
        <div class="request__title">${escapeHtml(step.step || "")}. ${escapeHtml(step.method || "GET")} ${escapeHtml(step.url || "")}</div>
        <div class="request__meta">${escapeHtml(formatStepTiming(step))}</div>
      </div>
      <div class="request__meta">Status ${escapeHtml(String(step.status || ""))}</div>
    </div>
    <div class="request__meta">${escapeHtml(step.contentType || "unknown content type")}</div>
  `;

  if (requestBody) {
    card.appendChild(renderCodeBlock("Request body", requestBody, {
      collapsed: true,
      summary: "Подробнее: request body"
    }));
  }

  if (initiatorStack) {
    card.appendChild(renderCodeBlock("Frontend call stack", initiatorStack, {
      collapsed: true,
      summary: "Подробнее: frontend call stack"
    }));
  }

  if (matchedFields.length > 0) {
    const matches = document.createElement("div");
    matches.className = "match-list match-list--compact";
    matchedFields.forEach((field) => {
      const item = document.createElement("div");
      item.className = "match-row";
      item.innerHTML = `
        <span class="match-row__path">${escapeHtml(field.path || "")}</span>
        <span class="match-row__value">${escapeHtml(field.value || "")}</span>
      `;
      matches.appendChild(item);
    });
    card.appendChild(matches);
  }

  card.appendChild(renderCodeBlock("Response shape", JSON.stringify(step.response?.shape || {}, null, 2), {
    collapsed: true,
    summary: "Подробнее: структура ответа"
  }));
  card.appendChild(renderCodeBlock("Response preview", step.response?.bodyPreview || "", {
    collapsed: true,
    summary: "Подробнее: ответ API"
  }));

  return card;
}

function renderCodeBlock(title, value, options = {}) {
  const surface = document.createElement(options.collapsed ? "details" : "div");
  surface.className = `surface surface--code${options.debug ? " surface--debug" : ""}`;

  if (options.collapsed) {
    surface.innerHTML = `
      <summary>${escapeHtml(options.summary || `Подробнее: ${title}`)}</summary>
      <strong>${escapeHtml(title)}</strong>
      <pre>${escapeHtml(value || "")}</pre>
    `;
    return surface;
  }

  surface.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <pre>${escapeHtml(value || "")}</pre>
  `;
  return surface;
}

function renderDom(dom) {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <h2 class="section-title">DOM-снимок</h2>
    <div class="meta-grid">
      <article class="metric">
        <span class="metric__label">Элемент</span>
        <div class="metric__value">${escapeHtml(dom?.tagName || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Селектор</span>
        <div class="metric__value">${escapeHtml(dom?.selector || "—")}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Позиция</span>
        <div class="metric__value">${escapeHtml(JSON.stringify(dom?.rect || {}))}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Стили</span>
        <div class="metric__value">${escapeHtml(JSON.stringify(dom?.computedStyle || {}))}</div>
      </article>
    </div>
  `;

  if (dom?.previewHTML) {
    section.appendChild(renderElementPreview(dom.previewHTML));
  }

  section.appendChild(renderCodeBlock("Текст элемента", dom?.innerText || ""));
  section.appendChild(renderCodeBlock("HTML-фрагмент", dom?.outerHTML || "", {
    collapsed: true,
    summary: "Подробнее: HTML-фрагмент"
  }));
  return section;
}

function renderElementPreview(previewHTML) {
  const surface = document.createElement("div");
  surface.className = "surface";

  const title = document.createElement("strong");
  title.textContent = "Превью элемента";

  const frame = document.createElement("iframe");
  frame.className = "element-preview";
  frame.setAttribute("sandbox", "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = buildPreviewDocument(previewHTML);

  surface.append(title, frame);
  return surface;
}

function renderRequests(requests) {
  const section = document.createElement("section");
  section.className = "grid";

  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = `Выбранные запросы (${requests.length})`;
  section.appendChild(heading);

  const copy = document.createElement("p");
  copy.className = "section-copy";
  copy.textContent = "Подтверждённые ответы из локального захвата.";
  section.appendChild(copy);

  if (requests.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Нет выбранных запросов.";
    section.appendChild(empty);
    return section;
  }

  requests.forEach((request) => {
    const card = document.createElement("article");
    card.className = "request";
    card.innerHTML = `
      <div class="request__header">
        <div class="request__title">${escapeHtml(request.method || "")} ${escapeHtml(request.url || "")}</div>
        <div class="request__meta">Status ${escapeHtml(String(request.status || ""))}</div>
      </div>
      <div class="request__meta">${escapeHtml(request.contentType || "unknown content type")}</div>
    `;
    card.appendChild(renderCodeBlock("Response body", request.responseBody || "", {
      collapsed: true,
      summary: "Подробнее: сырой ответ"
    }));
    section.appendChild(card);
  });

  return section;
}

function getElementRecipe(capture) {
  if (capture.cloneSpec) {
    return capture.cloneSpec;
  }

  if (capture.elementRecipe) {
    return capture.elementRecipe;
  }

  const network = capture.network || [];
  return {
    version: 0,
    confidence: network.length > 0 ? "low" : "dom-only",
    element: {
      selector: capture.dom?.selector || "",
      tagName: capture.dom?.tagName || "",
      textPreview: capture.dom?.innerText || ""
    },
    domFacts: capture.dom?.facts || [],
    responseFacts: [],
    bindings: [],
    renderEvidence: [],
    apiSequence: network.map((request, index) => ({
      requestId: request.id || `request-${index + 1}`,
      step: index + 1,
      method: request.method || "GET",
      url: request.url || "",
      status: request.status || 0,
      contentType: request.contentType || "",
      calledAt: request.timestamp ? new Date(Number(request.timestamp)).toISOString() : "",
      relativeToInteractionMs: null,
      request: {
        headers: request.requestHeaders || {},
        body: request.requestBody || "",
        initiatorStack: request.initiatorStack || ""
      },
      response: {
        headers: request.responseHeaders || {},
        bodyPreview: request.responseBody || "",
        shape: {},
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
  if (Number.isFinite(step.relativeToInteractionMs)) {
    const sign = step.relativeToInteractionMs >= 0 ? "+" : "";
    parts.push(`${sign}${step.relativeToInteractionMs} мс от клика`);
  }

  return parts.join(" · ") || "Время неизвестно";
}

function buildPreviewDocument(previewHTML) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        padding: 16px;
        display: grid;
        place-items: center;
        background: #f8fafc;
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .preview-root {
        max-width: 100%;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <div class="preview-root">${previewHTML}</div>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("ru-RU");
}
