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
  wrapper.appendChild(renderOverview(capture, recipe));
  wrapper.appendChild(renderTabbedSections([
    {
      id: "fields",
      label: "Поля",
      node: renderFieldsTab(recipe)
    },
    {
      id: "api",
      label: "API",
      node: renderApiTab(recipe)
    },
    {
      id: "export",
      label: "Export",
      node: renderExportPanel(capture, recipe)
    },
    {
      id: "dom",
      label: "DOM",
      node: renderDom(capture.dom)
    },
    {
      id: "debug",
      label: "Debug",
      node: renderRequests(capture.network || [])
    }
  ]));

  stateEl.appendChild(wrapper);
  if (rawJsonPanelEl) {
    rawJsonPanelEl.open = false;
  }
  jsonEl.textContent = JSON.stringify(capture, null, 2);
}

function renderOverview(capture, recipe) {
  const section = document.createElement("section");
  section.className = "overview";

  const top = document.createElement("div");
  top.className = "overview-grid";

  const preview = document.createElement("div");
  preview.className = "overview-preview";
  if (capture.dom?.previewHTML) {
    preview.appendChild(renderElementPreview(capture.dom.previewHTML));
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Для элемента нет HTML-превью.";
    preview.appendChild(empty);
  }

  top.append(preview, renderMeta(capture, recipe));
  section.append(top, renderMinimalRecipeTable(recipe));
  return section;
}

function renderMeta(capture, recipe) {
  const section = document.createElement("section");
  section.className = "surface overview-summary";
  const bindings = getExportBindings(recipe);
  const steps = recipe.apiSequence || [];
  const dependencies = getApiDependencies(recipe);
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
      <article class="metric">
        <span class="metric__label">Уверенность</span>
        <div class="metric__value">${escapeHtml(formatConfidence(recipe.confidence))}</div>
      </article>
      <article class="metric">
        <span class="metric__label">API</span>
        <div class="metric__value">${steps.length}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Поля</span>
        <div class="metric__value">${bindings.length}</div>
      </article>
      <article class="metric">
        <span class="metric__label">Зависимости</span>
        <div class="metric__value">${dependencies.length}</div>
      </article>
    </div>
  `;
  return section;
}

function renderMinimalRecipeTable(recipe) {
  const section = document.createElement("section");
  section.className = "surface minimal-recipe";
  const groups = buildMinimalRecipeGroups(recipe);

  section.innerHTML = `
    <div class="minimal-recipe__header">
      <div>
        <h2 class="section-title">Минимальный рецепт</h2>
        <p class="section-copy">API URL и JSON-path данных, которые нужны для отображения выбранного виджета.</p>
      </div>
      <span>${escapeHtml(String(groups.reduce((count, group) => count + group.fields.length, 0)))} полей</span>
    </div>
  `;

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Поля данных пока не найдены.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "minimal-api-list";

  groups.forEach((group) => {
    const item = document.createElement("article");
    item.className = "minimal-api";

    const header = document.createElement("div");
    header.className = "minimal-api__header";
    header.innerHTML = `
      <span>#${escapeHtml(String(group.order || ""))}</span>
      <strong>${escapeHtml(group.method)} ${escapeHtml(group.url || "—")}</strong>
    `;

    const rows = document.createElement("div");
    rows.className = "minimal-api__rows";
    rows.innerHTML = `
      <div class="minimal-row minimal-row--head">
        <span>Данные</span>
        <span>JSON path</span>
        <span>В элементе</span>
        <span>В ответе</span>
        <span>Score</span>
      </div>
    `;

    group.fields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "minimal-row";
      row.innerHTML = `
        <span>
          <strong>${escapeHtml(field.name)}</strong>
          <small>${escapeHtml(field.type)}</small>
        </span>
        <code>${escapeHtml(field.jsonPath || "—")}</code>
        <span>${escapeHtml(field.displayValue || "—")}</span>
        <span>${escapeHtml(field.responseValue || "—")}</span>
        <strong>${escapeHtml(formatConfidenceScore(field.confidence))}</strong>
      `;
      rows.appendChild(row);
    });

    item.append(header, rows);
    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}

function buildMinimalRecipeGroups(recipe, options = {}) {
  const groups = new Map();
  const usedNames = new Map();

  getExportBindings(recipe, {
    includeDerived: options.includeDerived !== false
  }).slice(0, 40).forEach((binding, index) => {
    const method = binding.method || "GET";
    const url = binding.url || "";
    const key = `${method} ${url}`;
    const group = groups.get(key) || {
      method,
      url,
      order: binding.step || null,
      fields: []
    };
    const name = makeUniqueExportName(deriveExportFieldName(binding, index), usedNames);

    group.fields.push({
      fieldId: getBindingExportId(binding, index),
      requestId: binding.requestId || "",
      name,
      type: inferExportFieldType(binding),
      jsonPath: binding.responsePath || binding.path || "",
      displayValue: binding.domValue || binding.value || "",
      responseValue: binding.responseValue ?? binding.value ?? "",
      confidence: binding.confidence || null
    });
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function renderTabbedSections(tabs) {
  const section = document.createElement("section");
  section.className = "tabs";

  const nav = document.createElement("div");
  nav.className = "tabs__nav";
  nav.setAttribute("role", "tablist");

  const panels = document.createElement("div");
  panels.className = "tabs__panels";

  tabs.forEach((tab, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tabs__tab${index === 0 ? " tabs__tab--active" : ""}`;
    button.textContent = tab.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.setAttribute("aria-controls", `tab-panel-${tab.id}`);

    const panel = document.createElement("div");
    panel.className = "tabs__panel";
    panel.id = `tab-panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.hidden = index !== 0;
    panel.appendChild(tab.node);

    button.addEventListener("click", () => {
      nav.querySelectorAll(".tabs__tab").forEach((item) => {
        item.classList.remove("tabs__tab--active");
        item.setAttribute("aria-selected", "false");
      });
      panels.querySelectorAll(".tabs__panel").forEach((item) => {
        item.hidden = true;
      });
      button.classList.add("tabs__tab--active");
      button.setAttribute("aria-selected", "true");
      panel.hidden = false;
    });

    nav.appendChild(button);
    panels.appendChild(panel);
  });

  section.append(nav, panels);
  return section;
}

function renderExportPanel(capture, recipe) {
  const section = document.createElement("section");
  section.className = "grid export-panel";

  const bindings = getExportBindings(recipe).slice(0, 40);
  section.innerHTML = `
    <h2 class="section-title">Выгрузка JSON</h2>
    <p class="section-copy">В JSON попадёт только выбранный элемент, его HTML без CSS, связанные API и JSON-path нужных данных.</p>
  `;

  const minimalNote = document.createElement("div");
  minimalNote.className = "export-note";
  minimalNote.textContent = "Выберите только те поля, которые нужны для рендера. CSS, структура ответа, сырые ответы, DOM-контекст и debug в эту выгрузку не попадают.";

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
  section.append(minimalNote, fields, actions, preview);
  refreshPreview();
  return section;
}

function collectExportOptions(root) {
  return {
    selectedFieldIds: new Set(
      Array.from(root.querySelectorAll(".export-field__input:checked"))
        .map((input) => input.value)
    )
  };
}

function buildExportPayload(capture, recipe, options) {
  const selectedBindings = getSelectedExportBindings(recipe, options.selectedFieldIds);
  return {
    specVersion: "vorovayka.element-export.v1",
    element: buildElementOnlyExport(capture, recipe),
    api: buildElementOnlyApiExport(recipe, selectedBindings)
  };
}

function buildElementOnlyExport(capture, recipe) {
  return {
    tagName: recipe.element?.tagName || capture.dom?.tagName || "",
    text: recipe.element?.textPreview || capture.dom?.innerText || "",
    html: stripCssFromHtml(capture.dom?.outerHTML || capture.dom?.previewHTML || "")
  };
}

function stripCssFromHtml(html) {
  const text = String(html || "").trim();
  if (!text) {
    return "";
  }

  try {
    const template = document.createElement("template");
    template.innerHTML = text;
    template.content.querySelectorAll("style, link[rel~='stylesheet']").forEach((node) => {
      node.remove();
    });
    template.content.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("style");
      node.removeAttribute("class");
      node.removeAttribute("part");
    });
    return template.innerHTML;
  } catch {
    return text
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "")
      .replace(/\s(?:style|class|part)=["'][^"']*["']/gi, "");
  }
}

function buildElementOnlyApiExport(recipe, bindings) {
  const groups = buildMinimalRecipeGroups({
    ...recipe,
    bindings
  }, {
    includeDerived: false
  });
  const dependencies = getApiDependencies(recipe);

  return groups.map((group) => {
    const requestId = group.fields[0]?.requestId || findRequestIdForApiGroup(recipe, group) || "";
    const relatedDependencies = dependencies
      .filter((edge) => edge.toRequestId === requestId || edge.fromRequestId === requestId)
      .map((edge) => ({
        fromRequestId: edge.fromRequestId || "",
        toRequestId: edge.toRequestId || "",
        sourceJsonPath: edge.source?.path || edge.sourcePath || "",
        target: {
          location: edge.target?.location || "",
          path: edge.target?.path || edge.target?.key || ""
        }
      }));

    const item = {
      order: group.order,
      requestId,
      method: group.method,
      url: group.url,
      data: group.fields.map((field) => ({
        name: field.name,
        type: field.type,
        jsonPath: field.jsonPath,
        displayValue: field.displayValue || "",
        responseValue: field.responseValue || ""
      }))
    };

    if (relatedDependencies.length > 0) {
      item.dependencies = relatedDependencies;
    }

    return item;
  });
}

function findRequestIdForApiGroup(recipe, group) {
  const step = (recipe.apiSequence || []).find((item) => (
    item.step === group.order &&
    item.method === group.method &&
    item.url === group.url
  ));
  return step?.requestId || "";
}

function getExportBindings(recipe, options = {}) {
  const baseBindings = (recipe.bindings || recipe.dataRequirements || []);
  if (options.includeDerived === false) {
    return baseBindings;
  }

  return mergeDerivedPrimaryValueBindings(recipe, baseBindings);
}

function mergeDerivedPrimaryValueBindings(recipe, baseBindings) {
  const derived = [
    ...deriveSiblingPrimaryValueBindings(recipe, baseBindings),
    ...deriveNetworkPrimaryValueBindings(recipe, baseBindings),
    ...deriveMissingPrimaryValueBindings(recipe, baseBindings)
  ];
  if (derived.length === 0) {
    return baseBindings;
  }

  const seen = new Set();
  return [...baseBindings, ...derived].filter((binding) => {
    const key = [
      binding.requestId || "",
      binding.responsePath || binding.path || "",
      normalizeViewerText(binding.domValue || binding.value || ""),
      normalizeViewerText(binding.responseValue || "")
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function deriveMissingPrimaryValueBindings(recipe, baseBindings) {
  const domFacts = getPrimaryDomFacts(recipe);
  const responseFacts = recipe.responseFacts || [];
  if (domFacts.length === 0 || responseFacts.length === 0) {
    return [];
  }

  const scope = buildBindingScope(baseBindings);
  const existing = new Set(baseBindings.map((binding) => [
    binding.requestId || "",
    binding.responsePath || binding.path || "",
    normalizeViewerText(binding.domValue || binding.value || "")
  ].join("::")));
  const elementContext = normalizeViewerText([
    recipe.element?.textPreview,
    ...(recipe.element?.textFragments || [])
  ].filter(Boolean).join(" "));
  const candidates = [];

  domFacts.forEach((domFact) => {
    responseFacts.forEach((responseFact) => {
      if (!isResponseFactInScope(responseFact, scope)) {
        return;
      }

      const match = scorePrimaryValueFallback(domFact, responseFact, elementContext);
      if (!match) {
        return;
      }

      const key = [
        responseFact.requestId || "",
        responseFact.path || "",
        normalizeViewerText(domFact.value || "")
      ].join("::");
      if (existing.has(key)) {
        return;
      }

      candidates.push({
        id: `derived-${domFact.id || "dom"}-${responseFact.id || "response"}`,
        domFactId: domFact.id || "",
        responseFactId: responseFact.id || "",
        requestId: responseFact.requestId || "",
        step: responseFact.step || null,
        method: responseFact.method || "GET",
        url: responseFact.url || "",
        responsePath: responseFact.path || "",
        responseKey: responseFact.key || "",
        parentObjectPath: responseFact.parentObjectPath || "",
        domValue: domFact.value || "",
        responseValue: responseFact.value || "",
        kind: domFact.kind || responseFact.kind || "text",
        matchType: match.type,
        confidence: match.confidence,
        reasons: match.reasons,
        dom: {
          selector: domFact.selector || "",
          context: domFact.context || {},
          rect: domFact.rect || null
        },
        response: {
          siblingFields: responseFact.siblingFields || {}
        },
        evidence: []
      });
    });
  });

  return candidates
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || Number(a.step || 0) - Number(b.step || 0))
    .slice(0, 12);
}

function deriveSiblingPrimaryValueBindings(recipe, sourceBindings) {
  const domFacts = getPrimaryDomFacts(recipe);
  if (domFacts.length === 0 || sourceBindings.length === 0) {
    return [];
  }

  const elementContext = normalizeViewerText([
    recipe.element?.textPreview,
    ...(recipe.element?.textFragments || [])
  ].filter(Boolean).join(" "));
  const candidates = [];

  sourceBindings.forEach((binding) => {
    const siblingFields = binding.response?.siblingFields || {};
    const parentObjectPath = getBindingParentObjectPath(binding);
    if (!parentObjectPath || Object.keys(siblingFields).length === 0) {
      return;
    }

    Object.entries(siblingFields).forEach(([key, value]) => {
      if (key === binding.responseKey || !isPotentialPrimaryResponseValue(key, value)) {
        return;
      }

      const kind = classifyViewerFact(value);
      const responseFact = {
        id: `sibling-${binding.id || binding.bindingId || binding.requestId || "binding"}-${key}`,
        requestId: binding.requestId || "",
        step: binding.step || null,
        method: binding.method || "GET",
        url: binding.url || "",
        path: buildJsonChildPath(parentObjectPath, key),
        key,
        parentObjectPath,
        kind,
        value: String(value ?? ""),
        normalizedValue: normalizeViewerFactValue(value, kind),
        siblingFields
      };

      domFacts.forEach((domFact) => {
        const match = scorePrimaryValueFallback(domFact, responseFact, elementContext);
        if (!match) {
          return;
        }

        candidates.push({
          id: `derived-sibling-${domFact.id || "dom"}-${responseFact.id}`,
          domFactId: domFact.id || "",
          responseFactId: responseFact.id,
          requestId: responseFact.requestId,
          step: responseFact.step,
          method: responseFact.method,
          url: responseFact.url,
          responsePath: responseFact.path,
          responseKey: responseFact.key,
          parentObjectPath,
          domValue: domFact.value || "",
          responseValue: responseFact.value,
          kind: domFact.kind || responseFact.kind,
          matchType: match.type,
          confidence: Math.min(0.95, Math.round((match.confidence + 0.03) * 100) / 100),
          reasons: [...match.reasons, "same-response-object"],
          dom: {
            selector: domFact.selector || "",
            context: domFact.context || {},
            rect: domFact.rect || null
          },
          response: {
            siblingFields
          },
          evidence: []
        });
      });
    });
  });

  return candidates
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || Number(a.step || 0) - Number(b.step || 0))
    .slice(0, 12);
}

function deriveNetworkPrimaryValueBindings(recipe, sourceBindings) {
  const domFacts = getPrimaryDomFacts(recipe);
  const requests = getViewerNetworkRequests(recipe);
  if (domFacts.length === 0 || requests.length === 0) {
    return [];
  }

  const scope = buildBindingScope(sourceBindings);
  const elementContext = normalizeViewerText([
    recipe.element?.textPreview,
    ...(recipe.element?.textFragments || [])
  ].filter(Boolean).join(" "));
  const candidates = [];

  requests.forEach((request, requestIndex) => {
    const requestId = request.id || request.requestId || `request-${requestIndex + 1}`;
    if (scope.active && scope.requestIds.size > 0 && !scope.requestIds.has(requestId)) {
      return;
    }

    const parsed = parseViewerJsonBody(request.responseBody || request.response?.bodyPreview || "");
    if (parsed == null) {
      return;
    }

    walkViewerJsonValues(parsed, "$", (path, value) => {
      if (candidates.length >= 80 || value == null || typeof value === "object") {
        return;
      }

      const key = extractViewerJsonKey(path);
      if (!isPotentialPrimaryResponseValue(key, value)) {
        return;
      }

      const parentObjectPath = extractViewerParentObjectPath(path);
      const responseFact = {
        id: `raw-response-${requestId}-${path}`,
        requestId,
        step: request.step || findStepNumberForRequest(recipe, requestId) || requestIndex + 1,
        method: request.method || "GET",
        url: request.url || "",
        path,
        key,
        parentObjectPath,
        kind: classifyViewerFact(value),
        value: String(value ?? ""),
        normalizedValue: normalizeViewerFactValue(value),
        siblingFields: extractViewerSiblingFields(parsed, path)
      };

      if (!isResponseFactInScope(responseFact, scope)) {
        return;
      }

      domFacts.forEach((domFact) => {
        const match = scorePrimaryValueFallback(domFact, responseFact, elementContext);
        if (!match) {
          return;
        }

        candidates.push({
          id: `derived-raw-${domFact.id || "dom"}-${requestId}-${path}`,
          domFactId: domFact.id || "",
          responseFactId: responseFact.id,
          requestId,
          step: responseFact.step,
          method: responseFact.method,
          url: responseFact.url,
          responsePath: responseFact.path,
          responseKey: responseFact.key,
          parentObjectPath,
          domValue: domFact.value || "",
          responseValue: responseFact.value,
          kind: domFact.kind || responseFact.kind,
          matchType: match.type,
          confidence: Math.min(0.96, Math.round((match.confidence + 0.04) * 100) / 100),
          reasons: [...match.reasons, "raw-response-scan"],
          dom: {
            selector: domFact.selector || "",
            context: domFact.context || {},
            rect: domFact.rect || null
          },
          response: {
            siblingFields: responseFact.siblingFields || {}
          },
          evidence: []
        });
      });
    });
  });

  return candidates
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || Number(a.step || 0) - Number(b.step || 0))
    .slice(0, 20);
}

function buildBindingScope(bindings) {
  const requestIds = new Set();
  const objectKeys = new Set();

  bindings.forEach((binding) => {
    const requestId = binding.requestId || "";
    const parentPath = getBindingParentObjectPath(binding);
    if (requestId) {
      requestIds.add(requestId);
    }
    if (requestId && parentPath) {
      objectKeys.add(`${requestId}::${parentPath}`);
    }
  });

  return {
    active: requestIds.size > 0 || objectKeys.size > 0,
    requestIds,
    objectKeys
  };
}

function isResponseFactInScope(responseFact, scope) {
  if (!scope.active) {
    return true;
  }

  const requestId = responseFact.requestId || "";
  const parentPath = responseFact.parentObjectPath || extractViewerParentObjectPath(responseFact.path);
  if (scope.objectKeys.size > 0) {
    return Boolean(requestId && parentPath && scope.objectKeys.has(`${requestId}::${parentPath}`));
  }

  return (
    requestId && scope.requestIds.has(requestId)
  );
}

function getBindingParentObjectPath(binding) {
  return binding.parentObjectPath || extractViewerParentObjectPath(binding.responsePath || binding.path || "");
}

function extractViewerParentObjectPath(path) {
  return String(path || "$")
    .replace(/\.[^.[]+$/, "")
    .replace(/\[\d+\]\.[^.[]+$/, "");
}

function buildJsonChildPath(parentPath, key) {
  return `${parentPath || "$"}.${key}`;
}

function getViewerNetworkRequests(recipe) {
  if (Array.isArray(recipe.__viewerNetwork) && recipe.__viewerNetwork.length > 0) {
    return recipe.__viewerNetwork;
  }

  return (recipe.apiSequence || [])
    .filter((step) => step?.response?.bodyPreview)
    .map((step) => ({
      id: step.requestId,
      requestId: step.requestId,
      step: step.step,
      method: step.method,
      url: step.url,
      responseBody: step.response?.bodyPreview || ""
    }));
}

function parseViewerJsonBody(body) {
  const text = String(body || "").trim();
  if (!text || !/^[\[{]/.test(text)) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function walkViewerJsonValues(value, path, visitor, depth = 0, state = { visited: 0 }) {
  if (state.visited > 6000 || depth > 8) {
    return;
  }

  state.visited += 1;
  visitor(path, value);

  if (Array.isArray(value)) {
    value.slice(0, 250).forEach((item, index) => {
      walkViewerJsonValues(item, `${path}[${index}]`, visitor, depth + 1, state);
    });
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).slice(0, 250).forEach(([key, entryValue]) => {
      walkViewerJsonValues(entryValue, `${path}.${key}`, visitor, depth + 1, state);
    });
  }
}

function extractViewerJsonKey(path) {
  const match = String(path || "").match(/\.([^.[]+)(?:\[\d+\])?$/);
  return match ? match[1] : "";
}

function extractViewerSiblingFields(root, path) {
  const parent = getViewerJsonValueByPath(root, extractViewerParentObjectPath(path));
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parent)
      .filter(([, value]) => value != null && typeof value !== "object")
      .slice(0, 40)
      .map(([key, value]) => [key, String(value).slice(0, 160)])
  );
}

function getViewerJsonValueByPath(root, path) {
  if (path === "$") {
    return root;
  }

  const tokens = Array.from(String(path || "").replace(/^\$/, "").matchAll(/\.?([^\.\[\]]+)|\[(\d+)\]/g));
  let current = root;

  for (const token of tokens) {
    if (current == null) {
      return null;
    }
    if (token[2] != null) {
      current = Array.isArray(current) ? current[Number(token[2])] : null;
    } else {
      current = current[token[1]];
    }
  }

  return current;
}

function findStepNumberForRequest(recipe, requestId) {
  return (recipe.apiSequence || []).find((step) => step.requestId === requestId)?.step || null;
}

function isPotentialPrimaryResponseValue(key, value) {
  const text = String(value ?? "").trim();
  if (!text || isLowSignalExportValue(text)) {
    return false;
  }

  if (classifyViewerFact(text) !== "text") {
    return true;
  }

  return /(count|counter|amount|balance|quota|limit|days?|duration|total|remain|available|used|остат|кол|дн|дней|лимит)/i.test(key);
}

function isPrimaryVisibleFact(fact) {
  return ["duration", "number", "currency", "percent"].includes(fact?.kind) && Boolean(fact?.normalizedValue);
}

function getPrimaryDomFacts(recipe) {
  const seen = new Set();
  const facts = [];
  const addFact = (fact) => {
    if (!isPrimaryVisibleFact(fact)) {
      return;
    }
    const key = `${fact.kind}:${fact.normalizedValue}:${normalizeViewerText(fact.value || "")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    facts.push(fact);
  };

  (recipe.domFacts || []).forEach(addFact);
  extractPrimaryVisibleFactsFromText([
    recipe.element?.textPreview,
    ...(recipe.element?.textFragments || [])
  ].filter(Boolean).join(" ")).forEach(addFact);

  return facts;
}

function extractPrimaryVisibleFactsFromText(text) {
  const sourceText = String(text || "").replace(/\s+/g, " ").trim();
  if (!sourceText) {
    return [];
  }

  const facts = [];
  const push = (value, kind = classifyViewerFact(value)) => {
    const normalizedValue = normalizeViewerFactValue(value, kind);
    if (!normalizedValue) {
      return;
    }
    facts.push({
      id: `virtual-domfact-${facts.length + 1}`,
      kind,
      value: String(value ?? "").trim(),
      normalizedValue,
      selector: "",
      context: {
        selectedText: sourceText,
        elementText: sourceText,
        rowText: sourceText
      }
    });
  };

  Array.from(sourceText.matchAll(/[-+]?\d+(?:[.,]\d+)?\s*(?:дн(?:ей|я|ь)?|день|сут(?:ок|ки)?|day|days)/gi)).forEach((match) => {
    push(match[0], "duration");
  });

  Array.from(sourceText.matchAll(/[-+]?\d[\d\s.,]*(?:[%₽$€£¥]| руб\.?| rub| usd| eur)?/gi)).forEach((match) => {
    if (isEmbeddedViewerNumberMatch(sourceText, match.index || 0, match[0])) {
      return;
    }
    push(match[0], classifyViewerFact(match[0]));
  });

  return facts.slice(0, 20);
}

function isEmbeddedViewerNumberMatch(sourceText, index, value) {
  const before = sourceText[index - 1] || "";
  const after = sourceText[index + String(value || "").length] || "";
  return /[\p{L}\p{N}_]/u.test(before) || /[\p{L}_]/u.test(after);
}

function scorePrimaryValueFallback(domFact, responseFact, elementContext) {
  const compatibility = getPrimaryValueCompatibility(domFact, responseFact);
  if (!compatibility) {
    return null;
  }

  const contextText = normalizeViewerText([
    elementContext,
    domFact.context?.nearbyLabel,
    domFact.context?.rowText,
    domFact.context?.elementText,
    domFact.context?.selectedText
  ].filter(Boolean).join(" "));
  const siblingValues = Object.values(responseFact.siblingFields || {})
    .map(normalizeViewerText)
    .filter((value) => value.length >= 3 && value !== normalizeViewerText(responseFact.value || ""));
  const hasSiblingContext = siblingValues.some((value) => contextText.includes(value));
  const hasSemanticContext = hasSharedFallbackSemantic(contextText, responseFact);

  if (compatibility.weak && !hasSiblingContext && !hasSemanticContext) {
    return null;
  }

  const reasons = [...compatibility.reasons, "derived-visible-primary-value"];
  let confidence = compatibility.score;
  if (hasSiblingContext) {
    confidence += 0.18;
    reasons.push("same-object-context");
  }
  if (hasSemanticContext) {
    confidence += 0.12;
    reasons.push("semantic-context-match");
  }

  confidence = Math.min(0.92, Math.round(confidence * 100) / 100);
  if (confidence < 0.42) {
    return null;
  }

  return {
    type: compatibility.type,
    confidence,
    reasons
  };
}

function getPrimaryValueCompatibility(domFact, responseFact) {
  if (!domFact?.normalizedValue || !responseFact?.normalizedValue) {
    return null;
  }

  const numericKinds = ["number", "currency", "percent"];
  const sameNumericKind = numericKinds.includes(domFact.kind) && numericKinds.includes(responseFact.kind);
  if ((domFact.kind === responseFact.kind || sameNumericKind) && domFact.normalizedValue === responseFact.normalizedValue) {
    return {
      type: "normalized-value",
      score: domFact.kind === "duration" ? 0.7 : 0.56,
      reasons: ["normalized-value-match"],
      weak: isWeakViewerNumber(domFact.normalizedValue, domFact.kind)
    };
  }

  if (domFact.kind === "duration" && numericKinds.includes(responseFact.kind)) {
    const durationNumber = String(domFact.normalizedValue).split(":")[0];
    if (getViewerComparableNumbers(responseFact).has(durationNumber)) {
      return {
        type: "duration-number",
        score: 0.32,
        reasons: ["duration-number-match", "weak-numeric-match"],
        weak: true
      };
    }
  }

  return null;
}

function getViewerComparableNumbers(fact) {
  const values = new Set();
  if (fact?.normalizedValue) {
    values.add(String(fact.normalizedValue));
  }

  const paddedDecimal = normalizeViewerPaddedDecimal(fact?.value);
  if (paddedDecimal) {
    values.add(paddedDecimal);
  }

  return values;
}

function normalizeViewerPaddedDecimal(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  const match = text.match(/^([-+]?\d+)[,.](\d{1,4})$/);
  if (!match || !/^0+$/.test(match[2])) {
    return "";
  }

  return match[1].replace(/^\+/, "");
}

function isWeakViewerNumber(value, kind) {
  if (!["number", "currency", "percent"].includes(kind)) {
    return false;
  }

  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) < 10;
}

function hasSharedFallbackSemantic(contextText, responseFact) {
  const responseText = normalizeViewerText([
    responseFact.url,
    responseFact.path,
    responseFact.key,
    responseFact.parentObjectPath,
    ...Object.keys(responseFact.siblingFields || {}),
    ...Object.values(responseFact.siblingFields || {})
  ].filter(Boolean).join(" "));

  return hasAbsenceSemantic(contextText) && hasAbsenceSemantic(responseText);
}

function hasAbsenceSemantic(text) {
  return /(absen|absence|vacation|leave|timeoff|holiday|отпуск|отпуска|отгул|отгулы|больнич|дней|день)/i.test(text);
}

function getSelectedExportBindings(recipe, selectedFieldIds) {
  const bindings = getExportBindings(recipe);
  if (!selectedFieldIds || selectedFieldIds.size === 0) {
    return [];
  }

  const selected = bindings.filter((binding, index) => selectedFieldIds.has(getBindingExportId(binding, index)));
  return mergeDerivedPrimaryValueBindings(recipe, selected);
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

function renderFieldsTab(recipe) {
  const section = document.createElement("section");
  section.className = "grid";
  const bindings = getExportBindings(recipe);

  section.innerHTML = `
    <h2 class="section-title">Поля виджета</h2>
    <p class="section-copy">Значения из выбранного элемента, найденные в ответах API.</p>
  `;

  if (bindings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Для элемента пока не найдено полей из API.";
    section.appendChild(empty);
    return section;
  }

  section.appendChild(renderBindingExplorer(recipe));
  return section;
}

function renderApiTab(recipe) {
  const section = document.createElement("section");
  section.className = "grid";
  const steps = recipe.apiSequence || [];
  const apiDependencies = getApiDependencies(recipe);

  section.innerHTML = `
    <h2 class="section-title">API-вызовы</h2>
    <p class="section-copy">Подтверждённые запросы, их порядок, найденные поля и доказанные зависимости между вызовами.</p>
  `;

  if (steps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Для элемента сохранён только DOM-контекст.";
    section.appendChild(empty);
    return section;
  }

  if (apiDependencies.length > 0) {
    section.appendChild(renderSequenceDiagram(apiDependencies));
  }

  const sequence = document.createElement("div");
  sequence.className = "timeline";
  steps.forEach((step) => {
    sequence.appendChild(renderApiStep(step));
  });
  section.appendChild(sequence);
  return section;
}

function renderRecipe(recipe) {
  const section = document.createElement("section");
  section.className = "grid";

  const bindings = getExportBindings(recipe);
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

  const bindings = getExportBindings(recipe).slice(0, 40);
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
  return getExportBindings(recipe)
    .filter((item) => (
      getBindingExportId(item, 0) !== getBindingExportId(binding, 0) &&
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
    return attachViewerNetwork(capture.cloneSpec, capture.network || []);
  }

  if (capture.elementRecipe) {
    return attachViewerNetwork(capture.elementRecipe, capture.network || []);
  }

  const network = capture.network || [];
  return attachViewerNetwork({
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
  }, network);
}

function attachViewerNetwork(recipe, network) {
  return {
    ...recipe,
    __viewerNetwork: network
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

function normalizeViewerText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}%.,:+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyViewerFact(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "text";
  }
  if (/(?:[$€£₽¥]|руб\.?|rub|usd|eur)/i.test(text)) {
    return "currency";
  }
  if (/[-+]?\d+(?:[.,]\d+)?\s*(?:дн(?:ей|я|ь)?|день|сут(?:ок|ки)?|day|days)/i.test(text)) {
    return "duration";
  }
  if (/%/.test(text)) {
    return "percent";
  }
  if (/\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/.test(text)) {
    return "date";
  }
  if (/^[-+]?\d[\d\s.,]*(?:[%₽$€£¥]| руб\.?| rub| usd| eur)?$/i.test(text)) {
    return "number";
  }
  return "text";
}

function normalizeViewerFactValue(value, kind = classifyViewerFact(value)) {
  if (kind === "duration") {
    const number = normalizeViewerNumber(value);
    return number ? `${number}:day` : "";
  }
  if (["number", "currency", "percent"].includes(kind)) {
    return normalizeViewerNumber(value);
  }
  if (kind === "date") {
    return normalizeViewerText(value);
  }
  return normalizeViewerText(value);
}

function normalizeViewerNumber(value) {
  const raw = String(value ?? "")
    .replace(/[^\d,.\-+]/g, "")
    .replace(/\s+/g, "");
  if (!/\d/.test(raw)) {
    return "";
  }

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma >= 0 || lastDot >= 0) {
    const separatorIndex = Math.max(lastComma, lastDot);
    const decimalPart = raw.slice(separatorIndex + 1);
    if (decimalPart.length > 0 && decimalPart.length <= 2) {
      return `${raw.slice(0, separatorIndex).replace(/[,.]/g, "")}.${decimalPart}`.replace(/^\+/, "");
    }
    return raw.replace(/[,.]/g, "").replace(/^\+/, "");
  }

  return raw.replace(/^\+/, "");
}

function isLowSignalExportValue(value) {
  const normalized = normalizeViewerText(value);
  return (
    !normalized ||
    normalized === "true" ||
    normalized === "false" ||
    normalized === "null" ||
    normalized === "undefined"
  );
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
    "semantic-request-context": "семантика запроса совпала",
    "derived-visible-primary-value": "восстановлено из видимого значения",
    "same-response-object": "тот же объект ответа"
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
