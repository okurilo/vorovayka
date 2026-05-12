const NETWORK_EVENT = "__VOROVAYKA_NETWORK_EVENT__";
const ARMED_ORIGINS_KEY = "armedOrigins";
const LATEST_CAPTURE_STORAGE_KEY = "latestCapture";
const COPYABLE_CAPTURE_STORAGE_KEY = "copyableCapture";
const CAPTURE_REF_MARK = "__vorovaykaCaptureRef";
const FULL_CAPTURE_KEY = "active";
const MAX_HTML_CHARS = 50 * 1024;
const MAX_TEXT_CHARS = 12 * 1024;
const MAX_REQUEST_CHARS = 20 * 1024;
const MAX_RESPONSE_CHARS = 512 * 1024;
const MAX_PREVIEW_HTML_CHARS = 50 * 1024;
const MAX_STACK_CHARS = 8 * 1024;
const MAX_BUFFER_SIZE = 60;
const MAX_MUTATION_BUFFER_SIZE = 120;
const MAX_DOM_FACTS = 240;
const MAX_RESPONSE_FACTS_PER_REQUEST = 1500;
const MAX_TOTAL_RESPONSE_FACTS = 6000;
const MAX_REQUEST_FACTS = 180;
const MAX_BINDINGS = 160;
const MAX_CANDIDATES = 20;
const MAX_PRESELECTED_CANDIDATES = 6;
const MAX_API_DEPENDENCIES = 16;
const MAX_EVIDENCE_TIMELINE_EVENTS = 80;
const MAX_ANALYSIS_DIAGNOSTICS = 18;
const MAX_JSON_VISITED_VALUES = 6000;
const MAX_JSON_ARRAY_ITEMS = 250;
const MAX_JSON_OBJECT_KEYS = 250;
const STORAGE_PROFILES = {
  normal: {
    responseBodyChars: 12 * 1024,
    requestBodyChars: 4 * 1024,
    stackChars: 2 * 1024,
    responseFacts: 1800,
    siblingFields: 16,
    domHtmlChars: 24 * 1024,
    previewHtmlChars: 32 * 1024,
    mutationTrace: 20
  },
  tight: {
    responseBodyChars: 1500,
    requestBodyChars: 1000,
    stackChars: 800,
    responseFacts: 600,
    siblingFields: 8,
    domHtmlChars: 8 * 1024,
    previewHtmlChars: 12 * 1024,
    mutationTrace: 8
  }
};
const POST_CLICK_WINDOW_MS = 1500;
const DOM_RENDER_EVIDENCE_WINDOW_MS = 5000;
const UI_ROOT_ID = "vorovayka-root";
const PREVIEW_STYLE_PROPS = [
  "display",
  "box-sizing",
  "position",
  "inset",
  "font",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "color",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "box-shadow",
  "outline",
  "opacity",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "padding",
  "margin",
  "gap",
  "row-gap",
  "column-gap",
  "align-items",
  "align-content",
  "justify-items",
  "justify-content",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-column",
  "grid-row",
  "place-items",
  "place-content",
  "text-align",
  "white-space",
  "text-decoration",
  "text-transform",
  "vertical-align",
  "overflow",
  "overflow-x",
  "overflow-y",
  "object-fit",
  "aspect-ratio",
  "list-style",
  "list-style-type"
];
const BLOCKED_PREVIEW_TAGS = new Set(["script", "iframe", "object", "embed", "link", "meta", "base", "noscript"]);
const URL_ATTRIBUTE_NAMES = new Set(["src", "srcset", "href", "poster", "action", "formaction", "xlink:href"]);
const SENSITIVE_FIELD_PATTERN = /(token|secret|password|authorization|cookie|session|csrf|xsrf|api[-_]?key|jwt)/i;
const CURRENCY_PATTERN = /(?:[$€£₽¥]|руб\.?|rub|usd|eur)/i;
const DURATION_PATTERN = /[-+]?\d+(?:[.,]\d+)?\s*(?:дн(?:ей|я|ь)?|день|сут(?:ок|ки)?|day|days)/i;
const DURATION_MATCH_PATTERN = /[-+]?\d+(?:[.,]\d+)?\s*(?:дн(?:ей|я|ь)?|день|сут(?:ок|ки)?|day|days)/gi;
const DATE_PATTERN = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const DATE_MATCH_PATTERN = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;
const NUMBER_PATTERN = /[-+]?\d[\d\s.,]*(?:[%₽$€£¥]| руб\.?| rub| usd| eur)?/gi;
const SEMANTIC_GROUPS = [
  ["absence", ["absen", "absence", "vacation", "leave", "timeoff", "holiday", "отпуск", "отпуска", "отгул", "отгулы", "больнич", "дней", "день"]],
  ["service", ["service", "services", "сервис", "сервисы", "evaluation", "оценка", "5plus", "5+"]],
  ["person", ["employee", "person", "user", "staff", "сотрудник", "команда", "team"]],
  ["date", ["date", "period", "start", "end", "дата", "период", "начало", "конец"]]
];

const networkBuffer = [];
const mutationBuffer = [];
const channelToken = createChannelToken();
const scopedNetworkEvent = `${NETWORK_EVENT}:${channelToken}`;

let injected = false;
let captureEnabled = false;
let selectionActive = false;
let hoverEl = null;
let selectedEl = null;
let selectionStartedAt = 0;
let interactionTimestamp = 0;
let finalizeTimer = null;
let hintTimer = null;
let uiRoot = null;
let highlightBox = null;
let modal = null;
let mutationObserver = null;
let mutationSeq = 0;

window.addEventListener("message", handlePageMessage);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "START_CAPTURE") {
    if (!captureEnabled) {
      ensureUi();
      renderHint("Сбор сети на этом домене выключен. Включите его в popup.", {
        duration: 3200,
        destroyWhenHidden: true
      });
      return;
    }

    startSelection();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[ARMED_ORIGINS_KEY]) {
    return;
  }

  const next = changes[ARMED_ORIGINS_KEY].newValue;
  captureEnabled = isOriginArmed(next);
  if (captureEnabled) {
    injectPageScript();
    startMutationTrace();
  } else {
    stopMutationTrace();
  }
});

void initializeCapture();

async function initializeCapture() {
  const stored = await chrome.storage.local.get(ARMED_ORIGINS_KEY);
  captureEnabled = isOriginArmed(stored[ARMED_ORIGINS_KEY]);

  if (captureEnabled) {
    injectPageScript();
    startMutationTrace();
  }
}

function injectPageScript() {
  if (injected) {
    return;
  }

  if (!document.documentElement) {
    document.addEventListener("readystatechange", injectPageScript, { once: true });
    return;
  }

  injected = true;
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/injected.js");
  script.dataset.eventName = scopedNetworkEvent;
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function startMutationTrace() {
  if (mutationObserver) {
    return;
  }

  if (!document.documentElement) {
    document.addEventListener("readystatechange", startMutationTrace, { once: true });
    return;
  }

  mutationObserver = new MutationObserver(handleDomMutations);
  mutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    characterDataOldValue: true
  });
}

function stopMutationTrace() {
  if (mutationObserver) {
    mutationObserver.disconnect();
  }
  mutationObserver = null;
  mutationBuffer.length = 0;
}

function handleDomMutations(mutations) {
  if (!captureEnabled) {
    return;
  }

  const timestamp = Date.now();
  const seenSelectors = new Set();

  mutations.forEach((mutation) => {
    if (isExtensionMutation(mutation)) {
      return;
    }

    const element = getMutationElement(mutation.target);
    if (
      !element ||
      element === document.documentElement ||
      element === document.body ||
      uiRoot?.contains(element) ||
      !element.isConnected
    ) {
      return;
    }

    const selector = buildCssSelector(element);
    if (!selector || seenSelectors.has(selector)) {
      return;
    }
    seenSelectors.add(selector);

    const text = truncateText(element.textContent || "", 1200);
    const facts = extractFactsFromText(text, {
      source: "mutation",
      selector,
      context: {
        rowText: text,
        elementText: text
      }
    }).slice(0, 12);

    if (facts.length === 0) {
      return;
    }

    mutationSeq += 1;
    mutationBuffer.push({
      id: `mutation-${mutationSeq}`,
      timestamp,
      selector,
      textPreview: truncateText(text, 500),
      facts: facts.map(compactFact)
    });

    if (mutationBuffer.length > MAX_MUTATION_BUFFER_SIZE) {
      mutationBuffer.shift();
    }
  });
}

function isExtensionMutation(mutation) {
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.some((node) => (
    node === uiRoot ||
    uiRoot?.contains(node) ||
    uiRoot && node instanceof Element && node.contains(uiRoot)
  ));
}

function getMutationElement(target) {
  if (target instanceof Element) {
    return target.closest("tr, li, [role='row'], article, section, div, span, p") || target;
  }

  if (target?.parentElement) {
    return target.parentElement.closest("tr, li, [role='row'], article, section, div, span, p") || target.parentElement;
  }

  return null;
}

function handlePageMessage(event) {
  if (
    !captureEnabled ||
    event.source !== window ||
    !event.data ||
    event.data.type !== scopedNetworkEvent
  ) {
    return;
  }

  const record = normalizeNetworkRecord(event.data.payload);
  if (!record) {
    return;
  }

  networkBuffer.push(record);
  if (networkBuffer.length > MAX_BUFFER_SIZE) {
    networkBuffer.shift();
  }
}

function normalizeNetworkRecord(payload) {
  if (!payload || typeof payload.url !== "string") {
    return null;
  }

  const method = String(payload.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return null;
  }

  const url = payload.url;
  if (isBlacklistedUrl(url) || isStaticAsset(url)) {
    return null;
  }

  const contentType = String(payload.contentType || "").toLowerCase();
  if (!isAllowedContentType(contentType)) {
    return null;
  }

  const responseBody = truncateText(String(payload.responseBody || ""), MAX_RESPONSE_CHARS);

  return {
    id: payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    url,
    method,
    status: Number(payload.status) || 0,
    timestamp: Number(payload.timestamp) || Date.now(),
    contentType,
    requestBody: truncateText(String(payload.requestBody || ""), MAX_REQUEST_CHARS),
    initiatorStack: truncateText(String(payload.initiatorStack || ""), MAX_STACK_CHARS),
    responseBody,
    bodyTooLarge: Boolean(payload.bodyTooLarge || responseBody.length >= MAX_RESPONSE_CHARS),
    requestHeaders: sanitizeHeaders(payload.requestHeaders),
    responseHeaders: sanitizeHeaders(payload.responseHeaders)
  };
}

function startSelection() {
  if (selectionActive) {
    return;
  }

  ensureUi();
  selectionActive = true;
  selectedEl = null;
  hoverEl = null;
  selectionStartedAt = Date.now();
  renderHint("Выберите элемент на странице. Esc — отмена.", { persistent: true });
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeyDown, true);
}

function stopSelection() {
  selectionActive = false;
  hoverEl = null;
  renderHighlight(null);
  document.removeEventListener("pointermove", onPointerMove, true);
  document.removeEventListener("click", onClickCapture, true);
  document.removeEventListener("keydown", onKeyDown, true);
}

function onPointerMove(event) {
  if (!selectionActive) {
    return;
  }

  const target = getSelectableTarget(event.target);
  if (target === hoverEl) {
    return;
  }

  hoverEl = target;
  renderHighlight(target);
}

function onClickCapture(event) {
  if (!selectionActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const target = getSelectableTarget(event.target);
  if (!target) {
    return;
  }

  selectedEl = target;
  interactionTimestamp = Date.now();
  stopSelection();
  renderProgress("Готовлю анализ выбранного элемента...", 8);

  clearTimeout(finalizeTimer);
  finalizeTimer = window.setTimeout(async () => {
    try {
      const payload = await buildCapturePayload(target, renderProgress);
      hideHint();
      showSelectionDialog(payload);
    } catch (error) {
      console.warn("Failed to build capture payload", error);
      renderHint("Не удалось собрать анализ элемента.", {
        duration: 3200,
        destroyWhenHidden: true
      });
    }
  }, POST_CLICK_WINDOW_MS);
}

function onKeyDown(event) {
  if (event.key !== "Escape") {
    return;
  }

  clearTimeout(finalizeTimer);
  stopSelection();
  closeModal();
  destroyUi();
}

function getSelectableTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (uiRoot?.contains(target)) {
    return null;
  }

  return target;
}

async function buildCapturePayload(target, reportProgress = () => {}) {
  reportProgress("Снимаю DOM выбранного элемента...", 16);
  await yieldToBrowser();

  const dom = captureDomSnapshot(target, []);
  reportProgress("Извлекаю видимые значения из DOM...", 32);
  await yieldToBrowser();
  dom.facts = extractDomFacts(target);

  reportProgress(`Сравниваю с API-ответами: 0/${networkBuffer.length}`, 48);
  await yieldToBrowser();
  const candidates = await rankRequests(dom, interactionTimestamp, reportProgress);

  reportProgress("Собираю trace изменений DOM...", 82);
  await yieldToBrowser();
  const mutationTrace = collectRelevantMutationTrace(dom.facts || []);

  reportProgress("Готовлю список API-кандидатов...", 94);
  await yieldToBrowser();

  return {
    createdAt: new Date().toISOString(),
    page: {
      url: location.href,
      title: document.title
    },
    interaction: {
      type: "click",
      timestamp: interactionTimestamp || selectionStartedAt
    },
    dom,
    mutationTrace,
    networkCandidates: candidates
  };
}

function captureDomSnapshot(target, facts = null) {
  const rect = target.getBoundingClientRect();
  const styles = getComputedStyle(target);
  const dataset = {};
  const aria = {};

  Object.entries(target.dataset || {}).forEach(([key, value]) => {
    dataset[key] = truncateText(String(value), 500);
  });

  Array.from(target.attributes).forEach((attribute) => {
    if (attribute.name.startsWith("aria-")) {
      aria[attribute.name] = truncateText(attribute.value, 500);
    }
  });

  return {
    tagName: target.tagName.toLowerCase(),
    selector: buildCssSelector(target),
    attributes: captureSafeAttributes(target),
    ancestorChain: captureAncestorChain(target),
    outerHTML: truncateText(target.outerHTML || "", MAX_HTML_CHARS),
    rawHtml: truncateText(target.outerHTML || "", MAX_HTML_CHARS),
    cleanHtml: buildCleanDomHtml(target),
    previewHTML: buildSafePreviewHtml(target),
    innerText: truncateText(target.innerText || target.textContent || "", MAX_TEXT_CHARS),
    textFragments: extractTextFragments(target.innerText || target.textContent || ""),
    facts: facts ?? extractDomFacts(target),
    role: target.getAttribute("role") || "",
    dataset,
    aria,
    rect: {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height)
    },
    computedStyle: {
      display: styles.display,
      position: styles.position,
      width: styles.width,
      height: styles.height,
      color: styles.color,
      font: styles.font
    }
  };
}

function extractDomFacts(target) {
  const facts = [];
  const seen = new Set();
  const selectedText = truncateText(target.innerText || target.textContent || "", 900);
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = normalizeText(node.textContent || "");
      if (!text || text.length < 2) {
        return NodeFilter.FILTER_REJECT;
      }
      if (uiRoot?.contains(node.parentElement)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode() && facts.length < MAX_DOM_FACTS) {
    const node = walker.currentNode;
    const element = node.parentElement;
    if (!element) {
      continue;
    }

    const selector = buildCssSelector(element);
    const contextElement = findFactContextElement(element, target);
    const context = {
      elementText: truncateText(element.innerText || element.textContent || "", 500),
      rowText: truncateText(contextElement?.innerText || contextElement?.textContent || "", 700),
      selectedText,
      nearbyLabel: findNearbyLabel(element),
      parentSelector: contextElement ? buildCssSelector(contextElement) : selector
    };

    extractFactsFromText(node.textContent || "", {
      source: "dom",
      selector,
      rect: captureElementRect(element),
      context
    }).forEach((fact) => {
      const key = `${fact.kind}:${fact.normalizedValue}:${fact.selector}`;
      if (seen.has(key) || facts.length >= MAX_DOM_FACTS) {
        return;
      }
      seen.add(key);
      fact.id = `domfact-${facts.length + 1}`;
      facts.push(fact);
    });
  }

  return facts;
}

function extractFactsFromText(text, base = {}) {
  const sourceText = String(text || "").replace(/\s+/g, " ").trim();
  if (!sourceText) {
    return [];
  }

  const facts = [];
  const seen = new Set();
  const pushFact = (value, kind = classifyFact(value)) => {
    const normalizedValue = normalizeFactValue(value, kind);
    if (isLowSignalFact(normalizedValue, kind)) {
      return;
    }

    const key = `${kind}:${normalizedValue}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    facts.push({
      id: "",
      source: base.source || "text",
      kind,
      value: truncateText(String(value).trim(), 240),
      normalizedValue,
      selector: base.selector || "",
      rect: base.rect || null,
      context: base.context || {}
    });
  };

  const fragments = splitTextIntoFacts(sourceText);
  fragments.forEach((fragment) => pushFact(fragment));

  Array.from(sourceText.matchAll(DURATION_MATCH_PATTERN)).forEach((match) => {
    pushFact(match[0], "duration");
  });

  Array.from(sourceText.matchAll(NUMBER_PATTERN)).forEach((match) => {
    if (isEmbeddedNumberMatch(sourceText, match.index || 0, match[0])) {
      return;
    }
    pushFact(match[0], classifyFact(match[0]));
  });

  Array.from(sourceText.matchAll(DATE_MATCH_PATTERN)).forEach((match) => {
    pushFact(match[0], "date");
  });

  return facts.slice(0, 20);
}

function splitTextIntoFacts(text) {
  return String(text || "")
    .split(/[\r\n]+|[•·|]| {2,}/)
    .map((fragment) => fragment.replace(/\s+/g, " ").trim())
    .filter((fragment) => fragment.length >= 3 && fragment.length <= 180)
    .slice(0, 10);
}

function classifyFact(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "text";
  }
  if (CURRENCY_PATTERN.test(text)) {
    return "currency";
  }
  if (DURATION_PATTERN.test(text)) {
    return "duration";
  }
  if (/%/.test(text)) {
    return "percent";
  }
  if (DATE_PATTERN.test(text)) {
    return "date";
  }
  if (isNumericLikeText(text) && normalizeNumber(text)) {
    return "number";
  }
  return "text";
}

function normalizeFactValue(value, kind = classifyFact(value)) {
  if (kind === "duration") {
    return normalizeDuration(value);
  }

  if (kind === "number" || kind === "currency" || kind === "percent") {
    return normalizeNumber(value);
  }

  if (kind === "date") {
    return normalizeDate(value);
  }

  return normalizeText(value);
}

function normalizeDuration(value) {
  const number = normalizeNumber(value);
  return number ? `${number}:day` : "";
}

function isNumericLikeText(value) {
  const text = String(value || "").trim();
  return /^[-+]?\d[\d\s.,]*(?:[%₽$€£¥]| руб\.?| rub| usd| eur)?$/i.test(text);
}

function isEmbeddedNumberMatch(sourceText, index, value) {
  const before = sourceText[index - 1] || "";
  const after = sourceText[index + String(value || "").length] || "";
  return /[\p{L}\p{N}_]/u.test(before) || /[\p{L}_]/u.test(after);
}

function normalizeNumber(value) {
  const raw = String(value || "")
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

function normalizeDate(value) {
  const text = String(value || "").trim();
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const local = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (!local) {
    return normalizeText(text);
  }

  const year = local[3].length === 2 ? `20${local[3]}` : local[3];
  return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
}

function isLowSignalFact(value, kind) {
  if (!value) {
    return true;
  }

  if (kind === "text") {
    return isLowSignalMatchValue(value) || value.length < 3;
  }

  return value.length < 1;
}

function compactFact(fact) {
  return {
    id: fact.id || "",
    kind: fact.kind,
    value: fact.value,
    normalizedValue: fact.normalizedValue,
    selector: fact.selector || "",
    context: fact.context || {}
  };
}

function findFactContextElement(element, root) {
  const context = element.closest("tr, li, [role='row'], article, section, [data-testid], [data-test], [class*='row'], [class*='card']");
  if (context && root.contains(context)) {
    return context;
  }
  return element.parentElement && root.contains(element.parentElement) ? element.parentElement : element;
}

function findNearbyLabel(element) {
  const ariaLabel = element.getAttribute("aria-label") || element.closest("[aria-label]")?.getAttribute("aria-label");
  if (ariaLabel) {
    return truncateText(ariaLabel, 240);
  }

  const previous = element.previousElementSibling?.innerText || element.previousElementSibling?.textContent || "";
  if (normalizeText(previous)) {
    return truncateText(previous, 240);
  }

  return "";
}

function captureElementRect(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height)
  };
}

function collectRelevantMutationTrace(domFacts) {
  const keys = new Set((domFacts || []).map((fact) => fact.normalizedValue).filter(Boolean));
  if (keys.size === 0) {
    return [];
  }

  return mutationBuffer
    .filter((record) => record.facts?.some((fact) => keys.has(fact.normalizedValue)))
    .slice(-40);
}

function captureSafeAttributes(element) {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => {
        const name = attribute.name.toLowerCase();
        return (
          name !== "style" &&
          !name.startsWith("on") &&
          !URL_ATTRIBUTE_NAMES.has(name) &&
          !SENSITIVE_FIELD_PATTERN.test(name)
        );
      })
      .map((attribute) => [attribute.name, truncateText(attribute.value, 500)])
  );
}

function captureAncestorChain(element) {
  const chain = [];
  let current = element;

  while (current instanceof Element && chain.length < 6) {
    chain.push({
      tagName: current.tagName.toLowerCase(),
      selectorPart: buildSelectorPart(current),
      id: current.id || "",
      classList: Array.from(current.classList || []).slice(0, 5),
      role: current.getAttribute("role") || "",
      text: extractTextFragments(current.innerText || current.textContent || "")[0] || ""
    });
    current = current.parentElement;
  }

  return chain.reverse();
}

function buildCssSelector(element) {
  if (!(element instanceof Element)) {
    return "";
  }

  const parts = [];
  let current = element;

  while (current instanceof Element && current !== document.documentElement && parts.length < 6) {
    parts.unshift(buildSelectorPart(current));
    if (current.id) {
      break;
    }
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function buildSelectorPart(element) {
  const tagName = element.tagName.toLowerCase();

  if (element.id) {
    return `${tagName}#${cssEscapeValue(element.id)}`;
  }

  const classes = Array.from(element.classList || [])
    .filter(Boolean)
    .slice(0, 2)
    .map(cssEscapeValue);
  const classSelector = classes.length ? `.${classes.join(".")}` : "";
  const nthSelector = getNthOfTypeSelector(element);

  return `${tagName}${classSelector}${nthSelector}`;
}

function getNthOfTypeSelector(element) {
  const parent = element.parentElement;
  if (!parent) {
    return "";
  }

  const sameTagSiblings = Array.from(parent.children)
    .filter((sibling) => sibling.tagName === element.tagName);
  if (sameTagSiblings.length < 2) {
    return "";
  }

  return `:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`;
}

function cssEscapeValue(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function extractTextFragments(text) {
  const fragments = String(text || "")
    .split(/[\r\n]+|[.!?]\s+/)
    .map((fragment) => fragment.replace(/\s+/g, " ").trim())
    .filter((fragment) => fragment.length >= 3)
    .slice(0, 12);

  return Array.from(new Set(fragments));
}

function buildSafePreviewHtml(target) {
  try {
    const clone = target.cloneNode(true);
    sanitizePreviewTree(clone, target);
    return truncateText(clone.outerHTML || "", MAX_PREVIEW_HTML_CHARS);
  } catch {
    return "";
  }
}

function buildCleanDomHtml(target) {
  try {
    const clone = target.cloneNode(true);
    sanitizeCleanTree(clone);
    return truncateText(clone.outerHTML || "", MAX_HTML_CHARS);
  } catch {
    return "";
  }
}

function sanitizeCleanTree(node) {
  if (!(node instanceof Element)) {
    return;
  }

  if (BLOCKED_PREVIEW_TAGS.has(node.tagName.toLowerCase())) {
    node.remove();
    return;
  }

  Array.from(node.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value || "";
    if (
      name === "style" ||
      name === "class" ||
      name === "part" ||
      name.startsWith("on") ||
      name.startsWith("data-") ||
      SENSITIVE_FIELD_PATTERN.test(name)
    ) {
      node.removeAttribute(attribute.name);
      return;
    }

    if (URL_ATTRIBUTE_NAMES.has(name) && isInlineDataImageUrl(value)) {
      node.setAttribute(attribute.name, "[inline-data-image]");
    }
  });

  Array.from(node.children).forEach((child) => sanitizeCleanTree(child));
}

function sanitizePreviewTree(cloneNode, sourceNode) {
  if (!(cloneNode instanceof Element) || !(sourceNode instanceof Element)) {
    return;
  }

  if (BLOCKED_PREVIEW_TAGS.has(cloneNode.tagName.toLowerCase())) {
    cloneNode.remove();
    return;
  }

  Array.from(cloneNode.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value || "";
    if (
      name === "style" ||
      name.startsWith("on") ||
      SENSITIVE_FIELD_PATTERN.test(name)
    ) {
      cloneNode.removeAttribute(attribute.name);
      return;
    }

    if (URL_ATTRIBUTE_NAMES.has(name) && !isSafePreviewUrl(cloneNode.tagName, name, value)) {
      cloneNode.removeAttribute(attribute.name);
    }
  });

  const inlineStyle = getSafeInlineStyle(sourceNode);
  if (inlineStyle) {
    cloneNode.setAttribute("style", inlineStyle);
  }

  const cloneChildren = Array.from(cloneNode.children);
  const sourceChildren = Array.from(sourceNode.children);
  cloneChildren.forEach((child, index) => {
    sanitizePreviewTree(child, sourceChildren[index]);
  });
}

function getSafeInlineStyle(element) {
  const styles = getComputedStyle(element);
  const declarations = PREVIEW_STYLE_PROPS
    .map((property) => {
      const value = styles.getPropertyValue(property);
      if (!value || value.includes("url(")) {
        return "";
      }
      if (property === "position" && ["fixed", "sticky"].includes(value.trim())) {
        return "position: relative";
      }
      return `${property}: ${value}`;
    })
    .filter(Boolean);

  declarations.push("max-width: 100%");
  declarations.push("min-width: 0");
  return declarations.join("; ");
}

function isInlineDataImageUrl(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || "").trim());
}

function isSafePreviewUrl(tagName, attributeName, value) {
  const normalizedTag = String(tagName || "").toLowerCase();
  const normalizedAttribute = String(attributeName || "").toLowerCase();
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return false;
  }

  if (normalizedAttribute === "srcset") {
    return normalizedValue
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0] || "")
      .every(isInlineDataImageUrl);
  }

  if (normalizedAttribute === "src" || normalizedAttribute === "poster") {
    return isInlineDataImageUrl(normalizedValue);
  }

  if ((normalizedAttribute === "href" || normalizedAttribute === "xlink:href") && normalizedTag === "image") {
    return isInlineDataImageUrl(normalizedValue);
  }

  return false;
}

async function rankRequests(domSnapshot, eventTs, reportProgress = () => {}) {
  const domText = typeof domSnapshot === "string" ? domSnapshot : domSnapshot?.innerText || "";
  const domFacts = typeof domSnapshot === "string" ? [] : domSnapshot?.facts || [];
  const normalizedDomText = normalizeText(domText);
  const scored = [];

  for (const [index, record] of networkBuffer.entries()) {
    let score = 0;
    const isAfterInteraction = eventTs > 0 && record.timestamp >= eventTs;
    const isRecent = index >= Math.max(0, networkBuffer.length - 5);
    const textMatch = normalizedDomText && record.responseBody
      ? normalizeText(record.responseBody).includes(normalizedDomText.slice(0, 160))
      : false;
    const factMatch = scoreRequestAgainstFacts(record, domFacts);

    if (isAfterInteraction) {
      score += 5;
    }
    if (isRecent) {
      score += 2;
    }
    if (record.bodyTooLarge) {
      score -= 2;
    }
    if (textMatch) {
      score += 5;
    }
    if (factMatch.count > 0) {
      score += Math.min(14, 6 + factMatch.count * 2);
    }

    scored.push({
      ...record,
      score,
      reasons: {
        afterInteraction: isAfterInteraction,
        recent: isRecent,
        textMatch,
        factMatch: factMatch.count > 0,
        factMatchCount: factMatch.count
      }
    });

    if (index % 3 === 0 || index === networkBuffer.length - 1) {
      reportProgress(
        `Сравниваю с API-ответами: ${index + 1}/${networkBuffer.length}`,
        48 + Math.round(((index + 1) / Math.max(1, networkBuffer.length)) * 28)
      );
      await yieldToBrowser();
    }
  }

  const selected = scored
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.timestamp - a.timestamp;
    })
    .slice(0, MAX_CANDIDATES);
  const preselectedIds = new Set(
    selected
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.timestamp - a.timestamp;
      })
      .slice(0, Math.min(MAX_PRESELECTED_CANDIDATES, selected.length))
      .map((record) => record.id)
  );

  return selected.map((record) => ({
    ...record,
    responsePreview: buildResponsePreview(record.responseBody, record.contentType),
    preselected: preselectedIds.has(record.id)
  }));
}

function scoreRequestAgainstFacts(record, domFacts) {
  if (!domFacts.length) {
    return { count: 0 };
  }

  const responseFacts = extractResponseFacts(record, 0);
  const responseKeys = new Set(responseFacts.map((fact) => `${fact.kind}:${fact.normalizedValue}`));
  const numericKeys = new Set(
    responseFacts
      .filter((fact) => ["number", "currency", "percent"].includes(fact.kind))
      .map((fact) => fact.normalizedValue)
  );
  let count = 0;

  domFacts.forEach((fact) => {
    if (responseKeys.has(`${fact.kind}:${fact.normalizedValue}`)) {
      count += 1;
      return;
    }

    if (["number", "currency", "percent"].includes(fact.kind) && numericKeys.has(fact.normalizedValue)) {
      count += 1;
      return;
    }

    if (fact.kind === "duration" && hasComparableDurationNumber(fact, responseFacts)) {
      count += 1;
    }
  });

  return { count };
}

function showSelectionDialog(payload) {
  ensureUi();
  closeModal();

  modal = document.createElement("div");
  modal.className = "vorovayka-modal";

  const heading = document.createElement("div");
  heading.className = "vorovayka-modal__heading";
  heading.textContent = "Выберите запросы для рецепта элемента";

  const summary = document.createElement("div");
  summary.className = "vorovayka-modal__summary";
  summary.textContent = `${payload.networkCandidates.length} кандидатов для проверки. Отмечены лучшие по score, но список расширен.`;

  const list = document.createElement("div");
  list.className = "vorovayka-modal__list";

  if (payload.networkCandidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "vorovayka-modal__empty";
    empty.textContent = "Подходящих JSON/text запросов не найдено. Можно сохранить только DOM и HTML-превью.";
    list.appendChild(empty);
  }

  payload.networkCandidates.forEach((candidate, index) => {
    const label = document.createElement("label");
    label.className = "vorovayka-modal__item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(candidate.preselected);
    checkbox.dataset.index = String(index);

    const meta = document.createElement("div");
    meta.className = "vorovayka-modal__meta";
    meta.innerHTML = [
      `<strong>${escapeHtml(candidate.method)} ${escapeHtml(shortenUrl(candidate.url))}</strong>`,
      `<span>Status ${candidate.status || "?"} · score ${candidate.score} · ${escapeHtml(candidate.contentType || "unknown")}</span>`,
      `<small>${escapeHtml(candidate.responsePreview || "Preview ответа недоступен.")}</small>`
    ].join("");

    label.appendChild(checkbox);
    label.appendChild(meta);
    list.appendChild(label);
  });

  const actions = document.createElement("div");
  actions.className = "vorovayka-modal__actions";
  const progress = document.createElement("div");
  progress.className = "vorovayka-modal__progress";
  progress.hidden = true;

  const openReceiverButton = document.createElement("button");
  openReceiverButton.textContent = "Открыть viewer";
  openReceiverButton.addEventListener("click", async () => {
    setModalBusy(actions, progress, "Собираю cloneSpec...", 12);
    try {
      await persistLatestCapture(payload, list, (text, percent) => {
        setModalBusy(actions, progress, text, percent);
      });
      await chrome.runtime.sendMessage({ type: "OPEN_RECEIVER" });
      renderHint("Viewer открыт.", {
        duration: 2200,
        destroyWhenHidden: true
      });
      closeModal();
    } catch (error) {
      console.warn("Failed to open viewer", error);
      setModalBusy(actions, progress, "Не удалось открыть viewer.", 100, false);
    }
  });

  const saveButton = document.createElement("button");
  saveButton.textContent = "Сохранить capture";
  saveButton.addEventListener("click", async () => {
    setModalBusy(actions, progress, "Собираю cloneSpec...", 12);
    try {
      await persistLatestCapture(payload, list, (text, percent) => {
        setModalBusy(actions, progress, text, percent);
      });
      renderHint("Захват сохранён.", {
        duration: 2200,
        destroyWhenHidden: true
      });
      closeModal();
    } catch (error) {
      console.warn("Failed to persist capture", error);
      setModalBusy(actions, progress, "Не удалось сохранить capture.", 100, false);
    }
  });

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "Закрыть";
  cancelButton.addEventListener("click", () => {
    closeModal();
    destroyUi();
  });

  actions.append(openReceiverButton, saveButton, cancelButton);
  modal.append(heading, summary, list, progress, actions);
  uiRoot.appendChild(modal);
}

function setModalBusy(actions, progress, text, percent = 0, isBusy = true) {
  progress.hidden = false;
  progress.innerHTML = `
    <span>${escapeHtml(text)}</span>
    <div class="vorovayka-progress"><i style="width: ${Math.max(0, Math.min(100, percent))}%"></i></div>
  `;
  actions.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function stripTransientFields(record) {
  return {
    id: record.id,
    url: record.url,
    method: record.method,
    status: record.status,
    timestamp: record.timestamp,
    contentType: record.contentType,
    requestBody: record.requestBody,
    initiatorStack: record.initiatorStack,
    responseBody: record.responseBody,
    requestHeaders: record.requestHeaders,
    responseHeaders: record.responseHeaders
  };
}

async function persistLatestCapture(payload, list, reportProgress = () => {}) {
  reportProgress("Читаю выбранные API-кандидаты...", 18);
  await yieldToBrowser();

  const selected = Array.from(list.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => payload.networkCandidates[Number(input.dataset.index)])
    .slice(0, MAX_CANDIDATES)
    .map(stripTransientFields);

  reportProgress("Строю граф происхождения данных...", 34);
  await yieldToBrowser();
  const elementRecipe = await buildElementRecipe(
    payload.dom,
    selected,
    payload.interaction,
    payload.mutationTrace || [],
    reportProgress
  );

  reportProgress("Сохраняю локальный capture...", 92);
  await yieldToBrowser();
  const capture = {
    createdAt: payload.createdAt,
    page: payload.page,
    interaction: payload.interaction,
    dom: payload.dom,
    mutationTrace: payload.mutationTrace || [],
    elementRecipe,
    cloneSpec: elementRecipe,
    network: selected
  };
  capture.captureBundle = buildCaptureBundle(capture);
  capture.captureSummary = buildCaptureSummary(capture.captureBundle);
  await persistCaptureToStorage(capture, reportProgress);
  reportProgress("Планирую автоочистку временных данных...", 98);
  await yieldToBrowser();
  await chrome.runtime.sendMessage({ type: "SCHEDULE_CAPTURE_EXPIRY" });
}

async function persistCaptureToStorage(capture, reportProgress = () => {}) {
  await chrome.storage.local.remove([LATEST_CAPTURE_STORAGE_KEY, COPYABLE_CAPTURE_STORAGE_KEY]);

  let fullCaptureMeta = {
    available: false,
    key: FULL_CAPTURE_KEY
  };
  try {
    const response = await chrome.runtime.sendMessage({
      type: "STORE_FULL_CAPTURE",
      capture
    });
    if (response?.ok) {
      fullCaptureMeta = {
        available: true,
        key: response.fullCaptureKey || FULL_CAPTURE_KEY
      };
    }
  } catch {
    // Full capture is best-effort; compact storage remains the fallback.
  }

  const normalCapture = compactCaptureForStorage(capture, STORAGE_PROFILES.normal, "normal", fullCaptureMeta);
  try {
    await writeCaptureToStorage(normalCapture, fullCaptureMeta);
    return;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }
  }

  reportProgress("Сжимаю capture для storage quota...", 94);
  await yieldToBrowser();
  await chrome.storage.local.remove([LATEST_CAPTURE_STORAGE_KEY, COPYABLE_CAPTURE_STORAGE_KEY]);
  const tightCapture = compactCaptureForStorage(capture, STORAGE_PROFILES.tight, "tight", fullCaptureMeta);
  await writeCaptureToStorage(tightCapture, fullCaptureMeta);
}

async function writeCaptureToStorage(capture, fullCaptureMeta = {}) {
  await chrome.storage.local.set({
    [COPYABLE_CAPTURE_STORAGE_KEY]: capture,
    [LATEST_CAPTURE_STORAGE_KEY]: {
      [CAPTURE_REF_MARK]: true,
      storageKey: COPYABLE_CAPTURE_STORAGE_KEY,
      fullCaptureAvailable: Boolean(fullCaptureMeta.available),
      fullCaptureKey: fullCaptureMeta.key || FULL_CAPTURE_KEY,
      createdAt: capture.createdAt,
      page: capture.page || {}
    }
  });
}

function isQuotaExceededError(error) {
  return /quota/i.test(String(error?.message || error || ""));
}

function compactCaptureForStorage(capture, limits, profile, fullCaptureMeta = {}) {
  const recipe = compactRecipeForStorage(capture.cloneSpec || capture.elementRecipe, limits);
  return {
    createdAt: capture.createdAt,
    page: capture.page,
    interaction: capture.interaction,
    dom: compactDomForStorage(capture.dom, limits),
    mutationTrace: compactMutationTrace(capture.mutationTrace, limits),
    elementRecipe: recipe,
    cloneSpec: recipe,
    network: (capture.network || []).map((record) => compactNetworkRecordForStorage(record, limits)),
    captureBundle: compactCaptureBundle(capture.captureBundle, limits),
    captureSummary: capture.captureSummary || buildCaptureSummary(capture.captureBundle),
    storageMeta: {
      profile,
      latestCaptureUsesRef: true,
      rawResponseBodiesTruncated: true,
      fullCaptureAvailable: Boolean(fullCaptureMeta.available),
      fullCaptureKey: fullCaptureMeta.key || FULL_CAPTURE_KEY
    }
  };
}

function compactDomForStorage(dom = {}, limits) {
  return {
    ...dom,
    outerHTML: truncateText(String(dom.outerHTML || ""), limits.domHtmlChars),
    previewHTML: truncateText(String(dom.previewHTML || ""), limits.previewHtmlChars),
    innerText: truncateText(String(dom.innerText || ""), MAX_TEXT_CHARS),
    facts: (dom.facts || []).slice(0, MAX_DOM_FACTS).map(compactFact)
  };
}

function compactMutationTrace(trace = [], limits) {
  return (trace || []).slice(-limits.mutationTrace).map((record) => ({
    id: record.id,
    timestamp: record.timestamp,
    selector: record.selector,
    textPreview: truncateText(String(record.textPreview || ""), 300),
    facts: (record.facts || []).slice(0, 8).map(compactFact)
  }));
}

function compactNetworkRecordForStorage(record, limits) {
  const responseBody = String(record.responseBody || "");
  return {
    id: record.id,
    url: record.url,
    method: record.method,
    status: record.status,
    timestamp: record.timestamp,
    contentType: record.contentType,
    requestBody: truncateText(String(record.requestBody || ""), limits.requestBodyChars),
    initiatorStack: truncateText(String(record.initiatorStack || ""), limits.stackChars),
    responseBody: truncateText(responseBody, limits.responseBodyChars),
    bodyTooLarge: Boolean(record.bodyTooLarge || responseBody.length > limits.responseBodyChars),
    requestHeaders: record.requestHeaders || {},
    responseHeaders: record.responseHeaders || {}
  };
}

function compactCaptureBundle(bundle, limits) {
  if (!bundle) {
    return null;
  }

  return {
    ...bundle,
    dom: {
      ...(bundle.dom || {}),
      textPreview: truncateText(String(bundle.dom?.textPreview || ""), 500),
      previewHtml: truncateText(String(bundle.dom?.previewHtml || ""), limits.previewHtmlChars),
      cleanHtml: truncateText(String(bundle.dom?.cleanHtml || ""), limits.domHtmlChars),
      rawHtml: truncateText(String(bundle.dom?.rawHtml || ""), limits.domHtmlChars)
    },
    api: (bundle.api || []).map((record) => ({
      ...compactNetworkRecordForStorage(record, limits),
      responsePreview: record.responsePreview || buildResponsePreview(record.responseBody, record.contentType)
    }))
  };
}

function buildCaptureBundle(capture) {
  const dom = capture?.dom || {};
  return {
    specVersion: "vorovayka.capture-bundle.v1",
    capturedAt: capture?.createdAt || "",
    page: {
      title: capture?.page?.title || "",
      url: capture?.page?.url || ""
    },
    selection: {
      type: capture?.interaction?.type || "",
      timestamp: capture?.interaction?.timestamp || 0
    },
    dom: {
      tagName: dom.tagName || "",
      selector: dom.selector || "",
      textPreview: truncateText(String(dom.innerText || ""), 500),
      rect: dom.rect || {},
      previewHtml: dom.previewHTML || "",
      cleanHtml: dom.cleanHtml || "",
      rawHtml: dom.rawHtml || dom.outerHTML || ""
    },
    api: (capture?.network || []).map((record) => ({
      id: record.id,
      requestId: record.id,
      method: record.method,
      url: record.url,
      status: record.status,
      timestamp: record.timestamp,
      contentType: record.contentType,
      requestBody: record.requestBody,
      initiatorStack: record.initiatorStack,
      responseBody: record.responseBody,
      requestHeaders: record.requestHeaders || {},
      responseHeaders: record.responseHeaders || {},
      responsePreview: buildResponsePreview(record.responseBody, record.contentType)
    }))
  };
}

function buildCaptureSummary(bundle) {
  if (!bundle) {
    return null;
  }

  const textPreview = truncateText(String(bundle.dom?.textPreview || ""), 80);
  return {
    capturedAt: bundle.capturedAt || "",
    tagName: bundle.dom?.tagName || "",
    selector: bundle.dom?.selector || "",
    textPreview,
    apiCount: Array.isArray(bundle.api) ? bundle.api.length : 0,
    pageUrl: bundle.page?.url || ""
  };
}

function compactRecipeForStorage(recipe = {}, limits) {
  const bindings = (recipe.bindings || []).slice(0, MAX_BINDINGS).map((binding) => compactBindingForStorage(binding, limits));
  const referencedResponseFacts = new Set(bindings.map((binding) => binding.responseFactId).filter(Boolean));
  return {
    ...recipe,
    responseFacts: compactResponseFactsForStorage(recipe.responseFacts || [], referencedResponseFacts, limits),
    bindings,
    dataRequirements: (recipe.dataRequirements || []).slice(0, MAX_BINDINGS).map((item) => compactDataRequirementForStorage(item, limits)),
    renderEvidence: (recipe.renderEvidence || []).slice(0, MAX_BINDINGS),
    apiSequence: (recipe.apiSequence || []).map((step) => compactApiStepForStorage(step, limits)),
    storageMeta: {
      ...(recipe.storageMeta || {}),
      responseFactsCompacted: true
    }
  };
}

function compactResponseFactsForStorage(facts, referencedIds, limits) {
  const selected = [];
  const seen = new Set();
  const add = (fact) => {
    if (!fact?.id || seen.has(fact.id) || selected.length >= limits.responseFacts) {
      return;
    }
    seen.add(fact.id);
    selected.push(compactResponseFactForStorage(fact, limits));
  };

  facts.forEach((fact) => {
    if (referencedIds.has(fact.id)) {
      add(fact);
    }
  });
  facts.forEach(add);
  return selected;
}

function compactResponseFactForStorage(fact, limits) {
  return {
    ...fact,
    value: truncateText(String(fact.value || ""), 160),
    siblingFields: compactSiblingFields(fact.siblingFields, limits)
  };
}

function compactBindingForStorage(binding, limits) {
  return {
    ...binding,
    responseValue: truncateText(String(binding.responseValue || ""), 160),
    domValue: truncateText(String(binding.domValue || ""), 160),
    response: {
      ...(binding.response || {}),
      siblingFields: compactSiblingFields(binding.response?.siblingFields, limits)
    },
    evidence: (binding.evidence || []).slice(0, 3)
  };
}

function compactDataRequirementForStorage(item, limits) {
  return {
    ...item,
    value: truncateText(String(item.value || ""), 160),
    domValue: truncateText(String(item.domValue || ""), 160),
    evidence: (item.evidence || []).slice(0, 3),
    response: item.response ? {
      ...item.response,
      siblingFields: compactSiblingFields(item.response.siblingFields, limits)
    } : item.response
  };
}

function compactApiStepForStorage(step, limits) {
  return {
    ...step,
    request: {
      ...(step.request || {}),
      body: truncateText(String(step.request?.body || ""), limits.requestBodyChars),
      initiatorStack: truncateText(String(step.request?.initiatorStack || ""), limits.stackChars)
    },
    response: {
      ...(step.response || {}),
      bodyPreview: truncateText(String(step.response?.bodyPreview || ""), limits.responseBodyChars),
      matchedFields: (step.response?.matchedFields || []).slice(0, 80)
    },
    bindings: (step.bindings || []).slice(0, 80)
  };
}

function compactSiblingFields(fields = {}, limits) {
  return Object.fromEntries(
    Object.entries(fields || {})
      .slice(0, limits.siblingFields)
      .map(([key, value]) => [key, truncateText(String(value), 160)])
  );
}

async function buildElementRecipe(dom, network, interaction, mutationTrace = [], reportProgress = () => {}) {
  const orderedNetwork = [...network].sort((a, b) => a.timestamp - b.timestamp);
  const domFacts = (dom?.facts || []).map(compactFact);
  const responseFacts = [];

  for (const [index, request] of orderedNetwork.entries()) {
    responseFacts.push(...extractResponseFacts(request, index + 1));
    if (index % 2 === 0 || index === orderedNetwork.length - 1) {
      reportProgress(
        `Разбираю JSON-ответы: ${index + 1}/${orderedNetwork.length}`,
        42 + Math.round(((index + 1) / Math.max(1, orderedNetwork.length)) * 18)
      );
      await yieldToBrowser();
    }
  }
  responseFacts.splice(MAX_TOTAL_RESPONSE_FACTS);

  reportProgress("Связываю DOM-значения с JSON-path...", 66);
  await yieldToBrowser();
  const bindings = buildProvenanceBindings(domFacts, responseFacts, orderedNetwork, mutationTrace)
    .slice(0, MAX_BINDINGS);

  reportProgress("Собираю API-последовательность...", 78);
  await yieldToBrowser();
  const rawApiSequence = orderedNetwork.map((request, index) => {
    const requestId = getRequestId(request, index + 1);
    const requestBindings = bindings.filter((binding) => binding.requestId === requestId);

    return {
      requestId,
      step: index + 1,
      originalStep: index + 1,
      method: request.method || "GET",
      url: request.url || "",
      apiSignature: buildApiSignature(request.method || "GET", request.url || ""),
      normalizedUrl: normalizeApiUrlForDisplay(request.url || ""),
      status: request.status || 0,
      contentType: request.contentType || "",
      timestamp: request.timestamp || null,
      calledAt: formatIsoTimestamp(request.timestamp),
      relativeToInteractionMs: calculateRelativeTime(request.timestamp, interaction?.timestamp),
      request: {
        headers: request.requestHeaders || {},
        body: request.requestBody || "",
        initiatorStack: request.initiatorStack || ""
      },
      response: {
        headers: request.responseHeaders || {},
        bodyPreview: truncateText(request.responseBody || "", 3000),
        shape: extractResponseShape(request),
        matchedFields: requestBindings.map(bindingToMatchedField)
      },
      bindings: requestBindings.map(compactBindingForStep)
    };
  });
  const apiSequence = dedupeApiSequence(rawApiSequence);

  reportProgress("Ищу зависимости между API-вызовами...", 82);
  await yieldToBrowser();
  const apiDependencies = buildApiDependencies(orderedNetwork, responseFacts);
  const analysisDiagnostics = buildAnalysisDiagnostics(domFacts, responseFacts, bindings, orderedNetwork, mutationTrace);

  const dataRequirements = bindings.map(bindingToDataRequirement);
  const renderEvidence = bindings
    .flatMap((binding) => binding.evidence || [])
    .filter((evidence, index, list) => (
      index === list.findIndex((item) => item.mutationId === evidence.mutationId && item.bindingId === evidence.bindingId)
    ));
  const evidenceTimeline = buildEvidenceTimeline({
    interaction,
    apiSequence,
    apiDependencies,
    bindings,
    renderEvidence,
    analysisDiagnostics
  });

  reportProgress("Формирую cloneSpec для viewer...", 86);
  await yieldToBrowser();

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    confidence: inferRecipeConfidence(apiSequence, dataRequirements, bindings),
    element: {
      selector: dom?.selector || "",
      tagName: dom?.tagName || "",
      role: dom?.role || "",
      textPreview: truncateText(dom?.innerText || "", 600),
      textFragments: dom?.textFragments || [],
      attributes: dom?.attributes || {},
      ancestorChain: dom?.ancestorChain || [],
      rect: dom?.rect || {}
    },
    domFacts,
    responseFacts,
    bindings,
    renderEvidence,
    evidenceTimeline,
    analysisDiagnostics,
    apiSequence,
    apiDependencies,
    dataRequirements,
    sequence: buildSequenceSummary(apiDependencies)
  };
}

function dedupeApiSequence(steps = []) {
  const groups = new Map();

  steps.forEach((step) => {
    const signature = step.apiSignature || buildApiSignature(step.method, step.url);
    const group = groups.get(signature) || [];
    group.push({
      ...step,
      apiSignature: signature,
      normalizedUrl: step.normalizedUrl || normalizeApiUrlForDisplay(step.url || "")
    });
    groups.set(signature, group);
  });

  return Array.from(groups.values())
    .map(mergeApiStepGroup)
    .sort((a, b) => Number(a.originalStep || a.step || 0) - Number(b.originalStep || b.step || 0))
    .map((step, index) => ({
      ...step,
      step: index + 1,
      displayStep: index + 1
    }));
}

function mergeApiStepGroup(steps) {
  const ordered = [...steps].sort((a, b) => Number(a.originalStep || a.step || 0) - Number(b.originalStep || b.step || 0));
  const representative = selectRepresentativeApiStep(ordered);
  const matchedFields = dedupeMatchedFields(ordered.flatMap((step) => step.response?.matchedFields || []));
  const bindings = dedupeStepBindings(ordered.flatMap((step) => step.bindings || []));
  const timestamps = ordered
    .map((step) => Number(step.timestamp || 0))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const firstTimestamp = timestamps.length ? Math.min(...timestamps) : null;
  const lastTimestamp = timestamps.length ? Math.max(...timestamps) : null;

  return {
    ...representative,
    originalStep: representative.originalStep || representative.step,
    duplicateCount: ordered.length,
    duplicateRequestIds: ordered.map((step) => step.requestId).filter(Boolean),
    duplicateSteps: ordered.map((step) => step.originalStep || step.step).filter(Boolean),
    deduped: ordered.length > 1,
    firstTimestamp,
    lastTimestamp,
    calledAt: formatIsoTimestamp(representative.timestamp || firstTimestamp),
    response: {
      ...(representative.response || {}),
      matchedFields
    },
    bindings,
    collapsedRequests: ordered.map((step) => ({
      requestId: step.requestId,
      originalStep: step.originalStep || step.step,
      status: step.status || 0,
      calledAt: step.calledAt || formatIsoTimestamp(step.timestamp),
      matchedFields: step.response?.matchedFields?.length || 0
    }))
  };
}

function selectRepresentativeApiStep(steps) {
  return [...steps].sort((a, b) => {
    const fieldDiff = Number(b.response?.matchedFields?.length || 0) - Number(a.response?.matchedFields?.length || 0);
    if (fieldDiff !== 0) {
      return fieldDiff;
    }

    const statusDiff = Number(isSuccessfulStatus(b.status)) - Number(isSuccessfulStatus(a.status));
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const bodyDiff = String(b.response?.bodyPreview || "").length - String(a.response?.bodyPreview || "").length;
    if (bodyDiff !== 0) {
      return bodyDiff;
    }

    return Number(a.originalStep || a.step || 0) - Number(b.originalStep || b.step || 0);
  })[0] || steps[0] || {};
}

function isSuccessfulStatus(status) {
  const number = Number(status);
  return Number.isFinite(number) && number >= 200 && number < 400;
}

function dedupeMatchedFields(fields = []) {
  const bestByKey = new Map();

  fields.forEach((field) => {
    const key = `${field.path || ""}:${field.value || ""}:${field.match || ""}`;
    const current = bestByKey.get(key);
    if (!current || Number(field.confidence || 0) > Number(current.confidence || 0)) {
      bestByKey.set(key, field);
    }
  });

  return Array.from(bestByKey.values())
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 80);
}

function dedupeStepBindings(bindings = []) {
  const bestByKey = new Map();

  bindings.forEach((binding) => {
    const key = `${binding.domFactId || ""}:${binding.responsePath || ""}:${binding.responseValue || ""}`;
    const current = bestByKey.get(key);
    if (!current || Number(binding.confidence || 0) > Number(current.confidence || 0)) {
      bestByKey.set(key, binding);
    }
  });

  return Array.from(bestByKey.values())
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 80);
}

function buildApiSignature(method, url) {
  return `${String(method || "GET").toUpperCase()} ${normalizeApiUrlForSignature(url)}`;
}

function normalizeApiUrlForSignature(url) {
  try {
    const parsed = new URL(url || "", location.href);
    const params = [];
    parsed.searchParams.forEach((value, key) => {
      params.push([key, isVolatileQueryParam(key, value) ? "<volatile>" : normalizeQueryParamValue(value)]);
    });
    params.sort(([keyA, valueA], [keyB, valueB]) => `${keyA}=${valueA}`.localeCompare(`${keyB}=${valueB}`));
    const query = params.map(([key, value]) => `${key}=${value}`).join("&");
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return String(url || "").replace(/[?&](?:rquid|requestId|traceId|timestamp|ts|_)=([^&]+)/gi, "$&=<volatile>");
  }
}

function normalizeApiUrlForDisplay(url) {
  try {
    const parsed = new URL(url || "", location.href);
    const params = [];
    parsed.searchParams.forEach((value, key) => {
      params.push([key, isVolatileQueryParam(key, value) ? "<volatile>" : truncateText(value, 80)]);
    });
    params.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    const query = params.map(([key, value]) => `${key}=${value}`).join("&");
    return `${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return truncateText(String(url || ""), 240);
  }
}

function normalizeQueryParamValue(value) {
  const text = String(value || "");
  if (isVolatileQueryValue(text)) {
    return "<volatile>";
  }
  return text;
}

function isVolatileQueryParam(key, value) {
  return /^(?:_|t|ts|time|timestamp|rquid|requestid|request_id|traceid|trace_id|correlationid|correlation_id|nonce|random|rnd|cb|cachebuster|_dc)$/i.test(String(key || "")) ||
    isVolatileQueryValue(value);
}

function isVolatileQueryValue(value) {
  const text = String(value || "").trim();
  return (
    /^\d{12,}$/.test(text) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
  );
}

function buildEvidenceTimeline({ interaction, apiSequence, apiDependencies, bindings, renderEvidence, analysisDiagnostics }) {
  const events = [];

  if (interaction?.timestamp) {
    events.push({
      id: "timeline-interaction",
      type: "interaction",
      timestamp: interaction.timestamp,
      label: "Выбран элемент",
      detail: interaction.type || "click"
    });
  }

  (apiSequence || []).forEach((step) => {
    const matchedCount = step.response?.matchedFields?.length || step.bindings?.length || 0;
    const duplicateText = step.duplicateCount > 1 ? ` · свернуто ${step.duplicateCount} вызова` : "";
    events.push({
      id: `timeline-api-${step.requestId || step.step}`,
      type: matchedCount > 0 ? "api-match" : "api-call",
      timestamp: step.firstTimestamp || step.timestamp || null,
      requestId: step.requestId,
      step: step.step,
      label: `${step.method || "GET"} ${shortenUrl(step.normalizedUrl || step.url || "")}`,
      detail: matchedCount > 0 ? `${matchedCount} полей связано с DOM${duplicateText}` : `ответ захвачен${duplicateText}`,
      status: step.status || 0,
      confidence: getMaxMatchedFieldConfidence(step.response?.matchedFields || [])
    });
  });

  (bindings || []).slice(0, 24).forEach((binding) => {
    const step = findTimelineStepForRequest(apiSequence, binding.requestId);
    events.push({
      id: `timeline-binding-${binding.id || binding.bindingId || binding.responsePath}`,
      type: "data-match",
      timestamp: step?.firstTimestamp || step?.timestamp || null,
      requestId: binding.requestId,
      bindingId: binding.id || binding.bindingId || "",
      step: step?.step || binding.step || null,
      label: `${binding.responsePath || binding.path || "JSON path"} → ${binding.domValue || binding.value || ""}`,
      detail: `${binding.responseValue || ""}`,
      confidence: binding.confidence || null,
      reasons: binding.reasons || []
    });
  });

  (apiDependencies || []).forEach((edge) => {
    const targetStep = findTimelineStepForRequest(apiSequence, edge.toRequestId);
    events.push({
      id: `timeline-dependency-${edge.id || edge.fromRequestId}-${edge.toRequestId}`,
      type: "api-dependency",
      timestamp: targetStep?.firstTimestamp || targetStep?.timestamp || null,
      requestId: edge.toRequestId,
      step: targetStep?.step || edge.toStep || null,
      label: `${edge.fromLabel || edge.fromRequestId || "API"} → ${edge.toLabel || edge.toRequestId || "API"}`,
      detail: `${edge.source?.path || "response"} переиспользовано в ${formatRequestDependencyTarget(edge.target)}`,
      confidence: edge.confidence || null,
      value: truncateText(String(edge.value || ""), 160)
    });
  });

  (renderEvidence || []).forEach((evidence) => {
    const binding = (bindings || []).find((item) => item.id === evidence.bindingId) || {};
    events.push({
      id: `timeline-render-${evidence.mutationId || evidence.bindingId}`,
      type: "dom-render",
      timestamp: evidence.timestamp || null,
      requestId: binding.requestId || "",
      bindingId: evidence.bindingId || "",
      label: `DOM обновил ${binding.domValue || evidence.textPreview || "значение"}`,
      detail: evidence.delayMs != null ? `через ${evidence.delayMs} мс после API` : "DOM mutation trace",
      selector: evidence.selector || "",
      confidence: binding.confidence || null
    });
  });

  (analysisDiagnostics || [])
    .filter((item) => item.severity === "warning")
    .slice(0, 6)
    .forEach((item, index) => {
      events.push({
        id: `timeline-diagnostic-${index + 1}`,
        type: "diagnostic",
        timestamp: null,
        label: item.title || "Диагностика",
        detail: item.message || "",
        value: item.value || ""
      });
    });

  return dedupeTimelineEvents(events)
    .sort(compareTimelineEvents)
    .slice(0, MAX_EVIDENCE_TIMELINE_EVENTS);
}

function findTimelineStepForRequest(apiSequence = [], requestId) {
  if (!requestId) {
    return null;
  }

  return (apiSequence || []).find((step) => (
    step.requestId === requestId ||
    (step.duplicateRequestIds || []).includes(requestId)
  )) || null;
}

function getMaxMatchedFieldConfidence(fields = []) {
  const values = fields.map((field) => Number(field.confidence || 0)).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function dedupeTimelineEvents(events = []) {
  const seen = new Set();
  return events.filter((event) => {
    const key = [
      event.type,
      event.timestamp || "",
      event.requestId || "",
      event.bindingId || "",
      event.label || "",
      event.detail || ""
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compareTimelineEvents(a, b) {
  const timeA = Number(a.timestamp || 0);
  const timeB = Number(b.timestamp || 0);
  if (timeA > 0 && timeB > 0 && timeA !== timeB) {
    return timeA - timeB;
  }
  if (timeA > 0 && timeB <= 0) {
    return -1;
  }
  if (timeA <= 0 && timeB > 0) {
    return 1;
  }
  return getTimelineTypeOrder(a.type) - getTimelineTypeOrder(b.type);
}

function getTimelineTypeOrder(type) {
  const order = {
    interaction: 0,
    "api-call": 1,
    "api-match": 2,
    "data-match": 3,
    "api-dependency": 4,
    "dom-render": 5,
    diagnostic: 6
  };
  return order[type] ?? 10;
}

function buildAnalysisDiagnostics(domFacts, responseFacts, bindings, requests, mutationTrace) {
  const diagnostics = [];
  const add = (item) => diagnostics.push({
    severity: item.severity || "info",
    code: item.code || "analysis-note",
    title: item.title || "Диагностика анализа",
    message: item.message || "",
    hints: item.hints || [],
    value: item.value || "",
    kind: item.kind || "",
    selector: item.selector || "",
    candidates: item.candidates || []
  });

  if (!requests.length) {
    add({
      severity: "warning",
      code: "no-selected-api",
      title: "API не выбран",
      message: "Для рецепта не выбран ни один захваченный API-запрос.",
      hints: ["Включить сбор для домена до перезагрузки страницы.", "Оставить отмеченными API-кандидаты, которые могли отрисовать виджет."]
    });
  } else if (!responseFacts.length) {
    add({
      severity: "warning",
      code: "no-response-facts",
      title: "В выбранных API нет JSON-полей",
      message: "Ответы выбранных API не разобрались в набор JSON/text facts.",
      hints: ["Ответ мог быть не JSON.", "Значение могло прийти до вооружения домена.", "Ответ мог быть слишком большим или бинарным."]
    });
  }

  const boundDomFactIds = new Set((bindings || []).map((binding) => binding.domFactId).filter(Boolean));
  const boundValues = new Set((bindings || []).map((binding) => `${binding.kind || ""}:${normalizeFactValue(binding.domValue || "", binding.kind || classifyFact(binding.domValue))}`));

  selectDiagnosticDomFacts(domFacts)
    .filter((fact) => !boundDomFactIds.has(fact.id) && !boundValues.has(`${fact.kind}:${fact.normalizedValue}`))
    .slice(0, 10)
    .forEach((fact) => {
      const comparable = findComparableResponseFactsForDiagnostic(fact, responseFacts);
      if (comparable.length > 0) {
        add({
          severity: "warning",
          code: "value-found-without-context",
          title: "Значение найдено, но связь слабая",
          message: "Похожее значение есть в выбранных API, но не хватило контекста рядом с DOM и JSON-объектом, чтобы считать его источником виджета.",
          value: fact.value,
          kind: fact.kind,
          selector: fact.selector,
          candidates: comparable,
          hints: ["Проверьте соседние поля объекта ответа.", "Для маленьких чисел нужен label или semantic-context рядом."]
        });
        return;
      }

      add({
        severity: "warning",
        code: "value-not-found-in-selected-api",
        title: "Значение не найдено в выбранных API",
        message: "В выбранных ответах API нет значения, которое объясняет этот текст/число из DOM.",
        value: fact.value,
        kind: fact.kind,
        selector: fact.selector,
        hints: ["API мог быть вызван до включения capture.", "Нужный API мог быть снят с чекбокса.", "Значение могло быть вычислено фронтендом из другого поля."]
      });
    });

  if (bindings.length === 0 && responseFacts.length > 0 && requests.length > 0) {
    add({
      severity: "warning",
      code: "no-bindings",
      title: "Связи DOM↔API не построены",
      message: "Ответы API разобраны, но ни одно значение не набрало достаточную уверенность для связи с выбранным элементом.",
      hints: ["Откройте Debug и проверьте, нет ли нужного значения в невыбранном API.", "Для одиночных чисел нужен label, соседнее поле или DOM mutation evidence."]
    });
  }

  if (requests.some((request) => request.bodyTooLarge || String(request.responseBody || "").includes("...[truncated]"))) {
    add({
      severity: "info",
      code: "response-truncated",
      title: "Часть ответа была урезана",
      message: "Некоторые ответы дошли до локального лимита размера. Анализ использовал доступную часть ответа.",
      hints: ["Если нужное поле находится глубоко в большом JSON, оно могло не попасть в локальный фрагмент."]
    });
  }

  if (!mutationTrace.length && bindings.some((binding) => (binding.evidence || []).length === 0)) {
    add({
      severity: "info",
      code: "no-render-mutation-evidence",
      title: "Нет DOM mutation evidence",
      message: "Связи построены по значениям и контексту, но trace не увидел обновление DOM после ответа API.",
      hints: ["Это нормально для уже отрисованных элементов.", "Для ранних запросов включите capture до перезагрузки страницы."]
    });
  }

  return dedupeAnalysisDiagnostics(diagnostics).slice(0, MAX_ANALYSIS_DIAGNOSTICS);
}

function selectDiagnosticDomFacts(domFacts = []) {
  const seen = new Set();
  const selected = [];

  [...domFacts]
    .filter(isDiagnosticDomFact)
    .sort((a, b) => getDiagnosticFactPriority(b) - getDiagnosticFactPriority(a))
    .forEach((fact) => {
      const key = `${fact.kind}:${fact.normalizedValue}:${normalizeText(fact.value)}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      selected.push(fact);
    });

  return selected;
}

function isDiagnosticDomFact(fact) {
  if (!fact?.normalizedValue || isLowSignalFact(fact.normalizedValue, fact.kind)) {
    return false;
  }

  if (["duration", "currency", "percent"].includes(fact.kind)) {
    return true;
  }

  if (fact.kind === "number") {
    const number = Number(fact.normalizedValue);
    return Number.isFinite(number) && Math.abs(number) >= 10;
  }

  const text = normalizeText(fact.value || "");
  return text.length >= 4 && text.length <= 80 && !/^(?:оформить|подробнее|назад|далее|ok|да|нет)$/i.test(text);
}

function getDiagnosticFactPriority(fact) {
  if (fact.kind === "duration") {
    return 5;
  }
  if (["currency", "percent"].includes(fact.kind)) {
    return 4;
  }
  if (fact.kind === "number") {
    return 3;
  }
  return 1;
}

function findComparableResponseFactsForDiagnostic(domFact, responseFacts = []) {
  return responseFacts
    .map((responseFact) => ({
      responseFact,
      match: scoreFactMatch(domFact, responseFact)
    }))
    .filter((item) => item.match)
    .sort((a, b) => Number(b.match.score || 0) - Number(a.match.score || 0))
    .slice(0, 4)
    .map(({ responseFact, match }) => ({
      requestId: responseFact.requestId,
      step: responseFact.step,
      method: responseFact.method,
      url: responseFact.url,
      path: responseFact.path,
      key: responseFact.key,
      value: responseFact.value,
      match: match.type,
      reasons: match.reasons
    }));
}

function dedupeAnalysisDiagnostics(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.code}:${item.value}:${item.selector}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildSequenceSummary(apiDependencies) {
  return (apiDependencies || []).map((edge, index) => ({
    ...edge,
    step: index + 1,
    label: `${edge.source?.path || edge.sourcePath || "response"} → ${formatRequestDependencyTarget(edge.target)}`
  }));
}

function buildApiDependencies(requests, responseFacts) {
  if (!requests.length || !responseFacts.length) {
    return [];
  }

  const responseFactsByRequest = new Map();
  responseFacts.forEach((fact) => {
    if (!isDependencySourceFact(fact)) {
      return;
    }

    const list = responseFactsByRequest.get(fact.requestId) || [];
    list.push(fact);
    responseFactsByRequest.set(fact.requestId, list);
  });

  const requestFactsByRequest = new Map();
  requests.forEach((request, index) => {
    const requestId = getRequestId(request, index + 1);
    requestFactsByRequest.set(requestId, extractRequestFacts(request, index + 1, requestId));
  });

  const edges = [];
  requests.forEach((sourceRequest, sourceIndex) => {
    const sourceRequestId = getRequestId(sourceRequest, sourceIndex + 1);
    const sourceFacts = responseFactsByRequest.get(sourceRequestId) || [];

    if (sourceFacts.length === 0) {
      return;
    }

    requests.slice(sourceIndex + 1).forEach((targetRequest, offset) => {
      const targetIndex = sourceIndex + offset + 1;
      const targetRequestId = getRequestId(targetRequest, targetIndex + 1);
      const targetFacts = requestFactsByRequest.get(targetRequestId) || [];

      sourceFacts.forEach((responseFact) => {
        targetFacts.forEach((requestFact) => {
          const match = scoreApiDependency(responseFact, requestFact);
          if (!match) {
            return;
          }

          edges.push({
            id: "",
            fromRequestId: sourceRequestId,
            fromStep: sourceIndex + 1,
            fromSignature: buildApiSignature(sourceRequest.method || "GET", sourceRequest.url || ""),
            fromLabel: `${sourceRequest.method || "GET"} ${shortenUrl(sourceRequest.url || "")}`,
            toRequestId: targetRequestId,
            toStep: targetIndex + 1,
            toSignature: buildApiSignature(targetRequest.method || "GET", targetRequest.url || ""),
            toLabel: `${targetRequest.method || "GET"} ${shortenUrl(targetRequest.url || "")}`,
            source: {
              requestId: sourceRequestId,
              path: responseFact.path,
              key: responseFact.key,
              value: responseFact.value,
              kind: responseFact.kind
            },
            target: {
              requestId: targetRequestId,
              location: requestFact.location,
              path: requestFact.path,
              key: requestFact.key,
              value: requestFact.value,
              kind: requestFact.kind
            },
            value: responseFact.value,
            normalizedValue: responseFact.normalizedValue,
            matchType: requestFact.matchType,
            confidence: match.confidence,
            reasons: match.reasons
          });
        });
      });
    });
  });

  const deduped = dedupeApiDependencies(edges)
    .sort((a, b) => b.confidence - a.confidence || a.fromStep - b.fromStep || a.toStep - b.toStep)
    .slice(0, MAX_API_DEPENDENCIES);

  deduped.forEach((edge, index) => {
    edge.id = `api-dependency-${index + 1}`;
  });

  return deduped;
}

function extractRequestFacts(request, step, requestId = getRequestId(request, step)) {
  const facts = [];
  addUrlRequestFacts(facts, request, step, requestId);
  addBodyRequestFacts(facts, request, step, requestId);
  addHeaderRequestFacts(facts, request, step, requestId);
  return facts.slice(0, MAX_REQUEST_FACTS);
}

function addUrlRequestFacts(facts, request, step, requestId) {
  let parsedUrl;
  try {
    parsedUrl = new URL(request.url || "", location.href);
  } catch {
    return;
  }

  parsedUrl.searchParams.forEach((value, key) => {
    addRequestFact(facts, value, {
      requestId,
      step,
      location: "url",
      path: `query.${key}`,
      key,
      matchType: "request-url-query",
      contextText: `${parsedUrl.pathname} ${key}`
    });
  });

  parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .slice(0, 16)
    .forEach((segment, index) => {
      const kind = classifyFact(segment);
      const normalizedValue = normalizeFactValue(segment, kind);
      if (!isLikelyDynamicPathSegment(segment, normalizedValue, kind)) {
        return;
      }

      addRequestFact(facts, segment, {
        requestId,
        step,
        location: "url",
        path: `path[${index}]`,
        key: "",
        matchType: "request-url-path",
        contextText: parsedUrl.pathname
      });
    });
}

function addBodyRequestFacts(facts, request, step, requestId) {
  const bodyText = String(request.requestBody || "").trim();
  if (!bodyText || isRedactedOrSyntheticValue(bodyText)) {
    return;
  }

  const contentType = getHeaderValue(request.requestHeaders, "content-type");
  const parsed = parseJsonBody(bodyText, contentType);
  if (parsed != null) {
    walkJsonValues(parsed, "$", (path, value) => {
      if (facts.length >= MAX_REQUEST_FACTS || value == null || typeof value === "object") {
        return;
      }

      const key = extractJsonKey(path);
      addRequestFact(facts, value, {
        requestId,
        step,
        location: "body",
        path,
        key,
        matchType: "request-body-json",
        contextText: path
      });
    });
    return;
  }

  if (/^[^=&\s]+=[\s\S]*/.test(bodyText)) {
    try {
      const params = new URLSearchParams(bodyText);
      params.forEach((value, key) => {
        addRequestFact(facts, value, {
          requestId,
          step,
          location: "body",
          path: `form.${key}`,
          key,
          matchType: "request-body-form",
          contextText: key
        });
      });
      return;
    } catch {
      // Fall through to text facts.
    }
  }

  extractFactsFromText(bodyText, {
    source: "request",
    context: {
      requestId,
      step,
      location: "body"
    }
  }).forEach((fact, index) => {
    addRequestFact(facts, fact.value, {
      requestId,
      step,
      location: "body",
      path: `$text[${index}]`,
      key: "",
      matchType: "request-body-text",
      contextText: bodyText
    });
  });
}

function addHeaderRequestFacts(facts, request, step, requestId) {
  Object.entries(request.requestHeaders || {}).forEach(([key, value]) => {
    addRequestFact(facts, value, {
      requestId,
      step,
      location: "headers",
      path: key,
      key,
      matchType: "request-header",
      contextText: key
    });
  });
}

function addRequestFact(facts, rawValue, options) {
  const value = String(rawValue ?? "").trim();
  const key = String(options.key || "");
  const path = String(options.path || "");

  if (
    !value ||
    facts.length >= MAX_REQUEST_FACTS ||
    isRedactedOrSyntheticValue(value) ||
    SENSITIVE_FIELD_PATTERN.test(key) ||
    SENSITIVE_FIELD_PATTERN.test(path)
  ) {
    return;
  }

  const kind = classifyFact(value);
  const normalizedValue = normalizeFactValue(value, kind);
  if (isLowSignalFact(normalizedValue, kind) || isLikelySecretValue(value)) {
    return;
  }

  facts.push({
    id: `requestfact-${options.step}-${facts.length + 1}`,
    source: "request",
    requestId: options.requestId,
    step: options.step,
    location: options.location,
    path,
    key,
    kind,
    value: truncateText(value, 240),
    normalizedValue,
    matchType: options.matchType,
    contextText: truncateText(options.contextText || "", 500)
  });
}

function scoreApiDependency(responseFact, requestFact) {
  if (
    !responseFact.normalizedValue ||
    !requestFact.normalizedValue ||
    responseFact.normalizedValue !== requestFact.normalizedValue ||
    !areDependencyKindsCompatible(responseFact.kind, requestFact.kind)
  ) {
    return null;
  }

  const context = scoreDependencyContext(responseFact, requestFact);
  const weak = isWeakDependencyValue(responseFact, requestFact);
  if (weak && context.score <= 0) {
    return null;
  }

  const reasons = [
    "response-value-reused-in-request",
    requestFact.matchType,
    ...context.reasons
  ].filter(Boolean);
  const confidence = Math.min(
    0.97,
    roundConfidence(getDependencyBaseScore(responseFact, requestFact, weak) + context.score)
  );

  if (confidence < 0.42) {
    return null;
  }

  return {
    confidence,
    reasons
  };
}

function areDependencyKindsCompatible(sourceKind, targetKind) {
  if (sourceKind === targetKind) {
    return true;
  }

  const numericKinds = ["number", "currency", "percent"];
  return numericKinds.includes(sourceKind) && numericKinds.includes(targetKind);
}

function getDependencyBaseScore(responseFact, requestFact, weak) {
  if (requestFact.location === "headers") {
    return weak ? 0.32 : 0.72;
  }

  if (responseFact.kind === "text") {
    if (responseFact.normalizedValue.length >= 16) {
      return 0.78;
    }
    if (responseFact.normalizedValue.length >= 8) {
      return 0.64;
    }
    return weak ? 0.34 : 0.48;
  }

  if (responseFact.kind === "date" || responseFact.kind === "duration") {
    return 0.64;
  }

  return weak ? 0.28 : 0.56;
}

function scoreDependencyContext(responseFact, requestFact) {
  const reasons = [];
  let score = 0;
  const responseKey = normalizeText(responseFact.key || responseFact.path || "");
  const requestKey = normalizeText(requestFact.key || requestFact.path || "");

  if (
    responseKey &&
    requestKey &&
    Math.min(responseKey.length, requestKey.length) >= 2 &&
    (responseKey.includes(requestKey) || requestKey.includes(responseKey))
  ) {
    score += 0.14;
    reasons.push("request-key-context");
  }

  const responseGroups = getSemanticGroups([
    responseFact.url,
    responseFact.path,
    responseFact.key,
    responseFact.parentObjectPath,
    ...Object.keys(responseFact.siblingFields || {}),
    ...Object.values(responseFact.siblingFields || {})
  ].filter(Boolean).join(" "));
  const requestGroups = getSemanticGroups([
    requestFact.contextText,
    requestFact.path,
    requestFact.key,
    requestFact.location
  ].filter(Boolean).join(" "));
  const shared = [...responseGroups].filter((group) => requestGroups.has(group));

  if (shared.length > 0) {
    score += Math.min(0.18, shared.length * 0.09);
    reasons.push("semantic-request-context");
  }

  return {
    score,
    reasons
  };
}

function isWeakDependencyValue(responseFact, requestFact) {
  if (["number", "currency", "percent"].includes(responseFact.kind)) {
    const number = Number(responseFact.normalizedValue);
    return Number.isFinite(number) && Math.abs(number) < 10;
  }

  return requestFact.normalizedValue.length < 5;
}

function isDependencySourceFact(fact) {
  return (
    fact?.requestId &&
    fact.normalizedValue &&
    !isRedactedOrSyntheticValue(fact.value) &&
    !isLikelySecretValue(fact.value)
  );
}

function isLikelyDynamicPathSegment(value, normalizedValue, kind) {
  const text = String(value || "");
  if (kind === "date") {
    return true;
  }

  if (kind === "number") {
    const number = Number(normalizedValue);
    return Number.isFinite(number) && Math.abs(number) >= 10;
  }

  return text.length >= 6 && /[\d_-]/.test(text);
}

function isRedactedOrSyntheticValue(value) {
  const text = String(value || "").trim();
  return (
    !text ||
    /\[REDACTED\]/i.test(text) ||
    /^\[(?:Blob|ArrayBuffer|File|[A-Za-z]+Array)\b/i.test(text) ||
    text.includes("...[truncated]")
  );
}

function isLikelySecretValue(value) {
  const text = String(value || "").trim();
  return (
    /^Bearer\s+/i.test(text) ||
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(text) ||
    (text.length > 80 && /^[A-Za-z0-9._~+/=-]+$/.test(text))
  );
}

function dedupeApiDependencies(edges) {
  const bestByKey = new Map();

  edges.forEach((edge) => {
    const key = [
      edge.fromSignature || edge.fromRequestId,
      edge.toSignature || edge.toRequestId,
      edge.source?.path,
      edge.target?.location,
      edge.target?.path,
      edge.normalizedValue
    ].join(":");
    const current = bestByKey.get(key);
    if (!current || edge.confidence > current.confidence) {
      bestByKey.set(key, edge);
    }
  });

  return Array.from(bestByKey.values());
}

function formatRequestDependencyTarget(target = {}) {
  if (target.location === "headers") {
    return `header.${target.path || target.key || ""}`;
  }

  if (target.location === "body") {
    return `body.${target.path || target.key || ""}`;
  }

  return `url.${target.path || target.key || ""}`;
}

function bindingToMatchedField(binding) {
  return {
    bindingId: binding.id,
    path: binding.responsePath,
    value: binding.responseValue,
    match: binding.matchType,
    confidence: binding.confidence,
    reasons: binding.reasons
  };
}

function compactBindingForStep(binding) {
  return {
    id: binding.id,
    domFactId: binding.domFactId,
    responsePath: binding.responsePath,
    responseValue: binding.responseValue,
    confidence: binding.confidence,
    reasons: binding.reasons
  };
}

function bindingToDataRequirement(binding) {
  return {
    bindingId: binding.id,
    domFactId: binding.domFactId,
    requestId: binding.requestId,
    step: binding.step,
    url: binding.url,
    method: binding.method,
    path: binding.responsePath,
    value: binding.responseValue,
    domValue: binding.domValue,
    match: binding.matchType,
    confidence: binding.confidence,
    reasons: binding.reasons,
    evidence: binding.evidence
  };
}

function inferRecipeConfidence(apiSequence, dataRequirements, bindings = []) {
  const strongBindings = bindings.filter((binding) => binding.confidence >= 0.78).length;
  if (strongBindings >= 3 || dataRequirements.length >= 6) {
    return "high";
  }

  if (strongBindings > 0 || dataRequirements.length > 0) {
    return "medium";
  }

  if (apiSequence.length > 0) {
    return "low";
  }

  return "dom-only";
}

function calculateRelativeTime(timestamp, interactionTimestamp) {
  if (!timestamp || !interactionTimestamp) {
    return null;
  }

  return Math.round(Number(timestamp) - Number(interactionTimestamp));
}

function formatIsoTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function getRequestId(request, step) {
  return request.id || `request-${step}`;
}

function getHeaderValue(headers = {}, name) {
  const normalizedName = String(name || "").toLowerCase();
  const entry = Object.entries(headers || {})
    .find(([key]) => String(key || "").toLowerCase() === normalizedName);
  return entry ? String(entry[1] || "") : "";
}

function extractResponseShape(request) {
  const parsed = parseJsonBody(request.responseBody, request.contentType);
  if (parsed == null) {
    return {
      type: request.responseBody ? "text" : "empty",
      preview: truncateText(request.responseBody || "", 500)
    };
  }

  return buildDataShape(parsed);
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
  if (Array.isArray(value)) {
    const firstMeaningfulItem = value.find((item) => item != null);
    return {
      type: "array",
      length: value.length,
      item: depth >= 4 || firstMeaningfulItem == null ? { type: "unknown" } : buildDataShape(firstMeaningfulItem, depth + 1)
    };
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).slice(0, 16);
    if (depth >= 4) {
      return {
        type: "object",
        keys
      };
    }

    return {
      type: "object",
      keys: Object.fromEntries(keys.map((key) => [key, buildDataShape(value[key], depth + 1)]))
    };
  }

  return {
    type: value === null ? "null" : typeof value,
    example: truncateText(String(value ?? ""), 120)
  };
}

function extractResponseFacts(request, step) {
  const requestId = getRequestId(request, step);
  const parsed = parseJsonBody(request.responseBody, request.contentType);
  if (parsed == null) {
    return extractFactsFromText(request.responseBody || "", {
      source: "response",
      context: {
        requestId,
        url: request.url || "",
        step
      }
    }).map((fact, index) => ({
      ...compactFact(fact),
      id: `responsefact-${step}-${index + 1}`,
      requestId,
      step,
      method: request.method || "GET",
      url: request.url || "",
      path: "$",
      key: "",
      parentObjectPath: "$",
      siblingFields: {}
    }));
  }

  const facts = [];
  walkJsonValues(parsed, "$", (path, value) => {
    if (facts.length >= MAX_RESPONSE_FACTS_PER_REQUEST || value == null || typeof value === "object") {
      return;
    }

    const key = extractJsonKey(path);
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      return;
    }

    const rawValue = String(value);
    const kind = classifyFact(rawValue);
    const normalizedValue = normalizeFactValue(rawValue, kind);
    if (isLowSignalFact(normalizedValue, kind)) {
      return;
    }

    facts.push({
      id: `responsefact-${step}-${facts.length + 1}`,
      source: "response",
      requestId,
      step,
      method: request.method || "GET",
      url: request.url || "",
      path,
      key,
      parentObjectPath: extractParentObjectPath(path),
      siblingFields: extractSiblingFields(parsed, path),
      kind,
      value: truncateText(rawValue, 240),
      normalizedValue
    });
  });

  return facts;
}

function buildProvenanceBindings(domFacts, responseFacts, requests, mutationTrace) {
  const requestById = new Map(requests.map((request, index) => [getRequestId(request, index + 1), request]));
  const candidates = [];

  domFacts.forEach((domFact) => {
    responseFacts.forEach((responseFact) => {
      const match = scoreFactMatch(domFact, responseFact);
      if (!match) {
        return;
      }

      const request = requestById.get(responseFact.requestId) || {};
      const contextScore = scoreContextMatch(domFact, responseFact);
      const evidence = findRenderEvidence(domFact, responseFact, request, mutationTrace);
      let confidence = match.score + contextScore.score + (evidence.length > 0 ? 0.22 : 0);
      const reasons = [...match.reasons, ...contextScore.reasons];

      if (match.weak && contextScore.score <= 0) {
        return;
      }

      if (evidence.length > 0) {
        reasons.push("post-response-mutation");
      }

      if (request.timestamp && request.timestamp <= (interactionTimestamp || Date.now())) {
        confidence += 0.04;
      }

      confidence = Math.min(0.99, roundConfidence(confidence));
      if (confidence < 0.35) {
        return;
      }

      candidates.push({
        id: "",
        domFactId: domFact.id,
        requestId: responseFact.requestId,
        responseFactId: responseFact.id,
        step: responseFact.step,
        method: responseFact.method,
        url: responseFact.url,
        responsePath: responseFact.path,
        responseKey: responseFact.key,
        parentObjectPath: responseFact.parentObjectPath,
        domValue: domFact.value,
        responseValue: responseFact.value,
        kind: domFact.kind,
        matchType: match.type,
        confidence,
        reasons,
        dom: {
          selector: domFact.selector,
          context: domFact.context || {},
          rect: domFact.rect || null
        },
        response: {
          siblingFields: responseFact.siblingFields || {}
        },
        evidence: evidence.map((item) => ({
          ...item,
          bindingId: ""
        }))
      });
    });
  });

  const unique = dedupeBindings(candidates)
    .sort((a, b) => b.confidence - a.confidence || a.step - b.step)
    .slice(0, MAX_BINDINGS);

  unique.forEach((binding, index) => {
    binding.id = `binding-${index + 1}`;
    binding.evidence = binding.evidence.map((item) => ({
      ...item,
      bindingId: binding.id
    }));
  });

  return unique;
}

function hasComparableDurationNumber(domFact, responseFacts) {
  const durationNumber = String(domFact.normalizedValue || "").split(":")[0];
  if (!durationNumber) {
    return false;
  }

  return responseFacts.some((fact) => (
    ["number", "currency", "percent"].includes(fact.kind) &&
    factComparableNumbers(fact).has(durationNumber)
  ));
}

function factComparableNumbers(fact) {
  const values = new Set();
  if (fact?.normalizedValue) {
    values.add(String(fact.normalizedValue));
  }

  const paddedDecimal = normalizePaddedDecimalNumber(fact?.value);
  if (paddedDecimal) {
    values.add(paddedDecimal);
  }

  return values;
}

function normalizePaddedDecimalNumber(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  const match = text.match(/^([-+]?\d+)[,.](\d{1,4})$/);
  if (!match || !/^0+$/.test(match[2])) {
    return "";
  }

  return match[1].replace(/^\+/, "");
}

function scoreFactMatch(domFact, responseFact) {
  if (!domFact.normalizedValue || !responseFact.normalizedValue) {
    return null;
  }

  const sameKind = domFact.kind === responseFact.kind ||
    ["number", "currency", "percent"].includes(domFact.kind) && ["number", "currency", "percent"].includes(responseFact.kind);
  const reasons = [];

  if (sameKind && domFact.normalizedValue === responseFact.normalizedValue) {
    reasons.push(domFact.kind === "text" ? "exact-text-match" : "normalized-value-match");
    const weak = isWeakNumericMatch(domFact, responseFact);
    return {
      type: domFact.kind === "text" ? "exact-text" : "normalized-value",
      score: getBaseMatchScore(domFact, responseFact, weak),
      reasons: weak ? [...reasons, "weak-numeric-match"] : reasons,
      weak
    };
  }

  if (
    domFact.kind === "duration" &&
    ["number", "currency", "percent"].includes(responseFact.kind) &&
    factComparableNumbers(responseFact).has(domFact.normalizedValue.split(":")[0])
  ) {
    return {
      type: "duration-number",
      score: 0.24,
      reasons: ["duration-number-match", "weak-numeric-match"],
      weak: true
    };
  }

  if (domFact.kind === "text" && responseFact.kind === "text") {
    const domText = domFact.normalizedValue;
    const responseText = responseFact.normalizedValue;
    if (domText.length >= 5 && responseText.length >= 5 && (domText.includes(responseText) || responseText.includes(domText))) {
      return {
        type: "text-fragment",
        score: 0.36,
        reasons: ["text-fragment-match"],
        weak: false
      };
    }
  }

  return null;
}

function getBaseMatchScore(domFact, responseFact, isWeak) {
  if (domFact.kind === "text") {
    return 0.48;
  }

  if (domFact.kind === "duration" && responseFact.kind === "duration") {
    return 0.7;
  }

  return isWeak ? 0.2 : 0.58;
}

function isWeakNumericMatch(domFact, responseFact) {
  const numericKinds = ["number", "currency", "percent"];
  if (!numericKinds.includes(domFact.kind) || !numericKinds.includes(responseFact.kind)) {
    return false;
  }

  const number = Number(domFact.normalizedValue);
  return Number.isFinite(number) && Math.abs(number) < 10;
}

function scoreContextMatch(domFact, responseFact) {
  const contextText = normalizeText([
    domFact.context?.nearbyLabel,
    domFact.context?.rowText,
    domFact.context?.elementText,
    domFact.context?.selectedText
  ].filter(Boolean).join(" "));
  const siblingValues = Object.values(responseFact.siblingFields || {})
    .map((value) => normalizeFactValue(value, classifyFact(value)))
    .filter((value) => value && value !== responseFact.normalizedValue);
  const matchingSiblings = siblingValues.filter((value) => contextText.includes(value));
  const reasons = [];
  let score = 0;
  const semanticScore = scoreSemanticContext(domFact, responseFact);

  if (matchingSiblings.length > 0) {
    score += Math.min(0.26, matchingSiblings.length * 0.13);
    reasons.push("same-object-context");
  }

  if (responseFact.key && contextText.includes(normalizeText(responseFact.key))) {
    score += 0.08;
    reasons.push("response-key-context");
  }

  if (semanticScore.score > 0) {
    score += semanticScore.score;
    reasons.push(...semanticScore.reasons);
  }

  return {
    score,
    reasons
  };
}

function scoreSemanticContext(domFact, responseFact) {
  const domText = [
    domFact.value,
    domFact.context?.nearbyLabel,
    domFact.context?.rowText,
    domFact.context?.elementText,
    domFact.context?.selectedText
  ].filter(Boolean).join(" ");
  const responseText = [
    responseFact.url,
    responseFact.path,
    responseFact.key,
    responseFact.parentObjectPath,
    ...Object.keys(responseFact.siblingFields || {}),
    ...Object.values(responseFact.siblingFields || {})
  ].filter(Boolean).join(" ");
  const domGroups = getSemanticGroups(domText);
  const responseGroups = getSemanticGroups(responseText);
  const shared = [...domGroups].filter((group) => responseGroups.has(group));

  if (shared.length === 0) {
    return {
      score: 0,
      reasons: []
    };
  }

  return {
    score: Math.min(0.22, shared.length * 0.11),
    reasons: ["semantic-context-match"]
  };
}

function getSemanticGroups(text) {
  const normalized = normalizeText(text);
  const groups = new Set();

  SEMANTIC_GROUPS.forEach(([group, terms]) => {
    if (terms.some((term) => normalized.includes(term))) {
      groups.add(group);
    }
  });

  return groups;
}

function findRenderEvidence(domFact, responseFact, request, mutationTrace) {
  if (!request.timestamp) {
    return [];
  }

  return (mutationTrace || [])
    .filter((record) => (
      record.timestamp >= request.timestamp &&
      record.timestamp <= request.timestamp + DOM_RENDER_EVIDENCE_WINDOW_MS &&
      record.facts?.some((fact) => fact.normalizedValue === domFact.normalizedValue)
    ))
    .slice(0, 3)
    .map((record) => ({
      type: "dom-mutation",
      mutationId: record.id,
      timestamp: record.timestamp,
      selector: record.selector,
      responsePath: responseFact.path,
      delayMs: Math.round(record.timestamp - request.timestamp),
      textPreview: record.textPreview
    }));
}

function dedupeBindings(bindings) {
  const bestByPair = new Map();

  bindings.forEach((binding) => {
    const key = `${binding.domFactId}:${binding.requestId}:${binding.responsePath}`;
    const current = bestByPair.get(key);
    if (!current || binding.confidence > current.confidence) {
      bestByPair.set(key, binding);
    }
  });

  return Array.from(bestByPair.values());
}

function roundConfidence(value) {
  return Math.round(Number(value) * 100) / 100;
}

function extractJsonKey(path) {
  const match = String(path || "").match(/\.([^.[]+)(?:\[\d+\])?$/);
  if (match) {
    return match[1];
  }
  return "";
}

function extractParentObjectPath(path) {
  return String(path || "$")
    .replace(/\.[^.[]+$/, "")
    .replace(/\[\d+\]\.[^.[]+$/, "");
}

function extractSiblingFields(root, path) {
  const parent = getJsonValueByPath(root, extractParentObjectPath(path));
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parent)
      .filter(([key, value]) => (
        !SENSITIVE_FIELD_PATTERN.test(key) &&
        value != null &&
        typeof value !== "object"
      ))
      .slice(0, 12)
      .map(([key, value]) => [key, truncateText(String(value), 160)])
  );
}

function getJsonValueByPath(root, path) {
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

function findVisibleDataMatches(domText, request) {
  const parsed = parseJsonBody(request.responseBody, request.contentType);
  const normalizedDom = normalizeText(domText);
  if (parsed == null || !normalizedDom) {
    return [];
  }

  const fragments = extractMatchFragments(domText);
  const matches = [];

  walkJsonValues(parsed, "$", (path, value) => {
    if (matches.length >= 12 || value == null || typeof value === "object") {
      return;
    }

    const rawValue = String(value);
    const normalizedValue = normalizeText(rawValue);
    if (isLowSignalMatchValue(normalizedValue)) {
      return;
    }

    const exactVisibleValue = normalizedDom.includes(normalizedValue);
    const fragmentMatch = fragments.find((fragment) => (
      normalizedValue.includes(fragment) || fragment.includes(normalizedValue)
    ));

    if (!exactVisibleValue && !fragmentMatch) {
      return;
    }

    matches.push({
      path,
      value: truncateText(rawValue, 240),
      match: exactVisibleValue ? "visible-value" : "visible-fragment"
    });
  });

  return matches;
}

function extractMatchFragments(text) {
  const fragments = extractTextFragments(text)
    .flatMap((fragment) => fragment.split(/[,;|]/).concat(fragment))
    .map(normalizeText)
    .filter((fragment) => fragment.length >= 4 && !isLowSignalMatchValue(fragment));

  return Array.from(new Set(fragments)).slice(0, 40);
}

function walkJsonValues(value, path, visitor, depth = 0, state = { visited: 0 }) {
  if (state.visited > MAX_JSON_VISITED_VALUES || depth > 8) {
    return;
  }

  state.visited += 1;
  visitor(path, value);

  if (Array.isArray(value)) {
    value.slice(0, MAX_JSON_ARRAY_ITEMS).forEach((item, index) => {
      walkJsonValues(item, `${path}[${index}]`, visitor, depth + 1, state);
    });
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).slice(0, MAX_JSON_OBJECT_KEYS).forEach(([key, entryValue]) => {
      walkJsonValues(entryValue, `${path}.${key}`, visitor, depth + 1, state);
    });
  }
}

function isLowSignalMatchValue(value) {
  return (
    !value ||
    value.length < 3 ||
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value === "undefined" ||
    /^[0-9.,\s-]{1,2}$/.test(value)
  );
}

function ensureUi() {
  if (uiRoot?.isConnected) {
    return;
  }

  uiRoot = document.createElement("div");
  uiRoot.id = UI_ROOT_ID;
  uiRoot.innerHTML = `
    <style>
      #${UI_ROOT_ID} {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${UI_ROOT_ID} .vorovayka-highlight {
        position: fixed;
        border: 2px solid #ff7a18;
        background: rgba(255, 122, 24, 0.12);
        pointer-events: none;
        z-index: 2147483645;
      }
      #${UI_ROOT_ID} .vorovayka-hint {
        position: fixed;
        top: 16px;
        right: 16px;
        max-width: 360px;
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.96);
        color: #fff;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        z-index: 2147483646;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
      }
      #${UI_ROOT_ID} .vorovayka-modal {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 460px;
        max-width: calc(100vw - 32px);
        max-height: 70vh;
        overflow: auto;
        padding: 14px;
        border: 1px solid #dbe2ea;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.98);
        color: #0f172a;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
        z-index: 2147483647;
      }
      #${UI_ROOT_ID} .vorovayka-modal__heading {
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 4px;
      }
      #${UI_ROOT_ID} .vorovayka-modal__summary,
      #${UI_ROOT_ID} .vorovayka-modal__empty {
        color: #64748b;
        margin-bottom: 10px;
        font-size: 12px;
      }
      #${UI_ROOT_ID} .vorovayka-modal__progress {
        display: grid;
        gap: 8px;
        margin: 12px 0 0;
        color: #475569;
      }
      #${UI_ROOT_ID} .vorovayka-modal__progress[hidden] {
        display: none;
      }
      #${UI_ROOT_ID} .vorovayka-modal__list {
        display: grid;
        gap: 6px;
      }
      #${UI_ROOT_ID} .vorovayka-modal__item {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 8px;
        align-items: start;
        padding: 9px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #fcfdff;
      }
      #${UI_ROOT_ID} .vorovayka-modal__meta strong,
      #${UI_ROOT_ID} .vorovayka-modal__meta span,
      #${UI_ROOT_ID} .vorovayka-modal__meta small {
        display: block;
      }
      #${UI_ROOT_ID} .vorovayka-modal__meta span {
        color: #64748b;
      }
      #${UI_ROOT_ID} .vorovayka-modal__meta small {
        margin-top: 4px;
        color: #334155;
        font-size: 12px;
        line-height: 1.35;
      }
      #${UI_ROOT_ID} .vorovayka-modal__actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      #${UI_ROOT_ID} button {
        border: 0;
        border-radius: 10px;
        padding: 9px 12px;
        cursor: pointer;
        background: #0f172a;
        color: #fff;
        font: inherit;
      }
      #${UI_ROOT_ID} button:disabled {
        cursor: wait;
        opacity: 0.62;
      }
      #${UI_ROOT_ID} button:last-child {
        background: #e2e8f0;
        color: #0f172a;
      }
      #${UI_ROOT_ID} .vorovayka-progress {
        width: 100%;
        height: 6px;
        overflow: hidden;
        border-radius: 999px;
        background: #e2e8f0;
      }
      #${UI_ROOT_ID} .vorovayka-progress i {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: #0f766e;
        transition: width 160ms ease;
      }
    </style>
    <div class="vorovayka-hint" hidden></div>
    <div class="vorovayka-highlight" hidden></div>
  `;

  document.documentElement.appendChild(uiRoot);
  highlightBox = uiRoot.querySelector(".vorovayka-highlight");
}

function destroyUi() {
  clearTimeout(hintTimer);
  hintTimer = null;
  if (uiRoot?.isConnected) {
    uiRoot.remove();
  }
  uiRoot = null;
  highlightBox = null;
  modal = null;
}

function renderHint(text, options = {}) {
  ensureUi();
  const hint = uiRoot.querySelector(".vorovayka-hint");
  if (hint) {
    clearTimeout(hintTimer);
    hintTimer = null;
    hint.hidden = false;
    hint.textContent = text;

    if (!options.persistent) {
      hintTimer = window.setTimeout(() => {
        hideHint();
        if (options.destroyWhenHidden && !selectionActive && !modal) {
          destroyUi();
        }
      }, options.duration ?? 2400);
    }
  }
}

function renderProgress(text, percent = 0) {
  ensureUi();
  const hint = uiRoot.querySelector(".vorovayka-hint");
  if (!hint) {
    return;
  }

  clearTimeout(hintTimer);
  hintTimer = null;
  hint.hidden = false;
  hint.innerHTML = `
    <div>${escapeHtml(text)}</div>
    <div class="vorovayka-progress"><i style="width: ${Math.max(0, Math.min(100, percent))}%"></i></div>
  `;
}

function hideHint() {
  if (!uiRoot?.isConnected) {
    return;
  }

  const hint = uiRoot.querySelector(".vorovayka-hint");
  if (hint) {
    hint.hidden = true;
    hint.textContent = "";
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function renderHighlight(element) {
  if (!highlightBox) {
    return;
  }

  if (!element) {
    highlightBox.hidden = true;
    return;
  }

  const rect = element.getBoundingClientRect();
  highlightBox.hidden = false;
  highlightBox.style.left = `${rect.left}px`;
  highlightBox.style.top = `${rect.top}px`;
  highlightBox.style.width = `${rect.width}px`;
  highlightBox.style.height = `${rect.height}px`;
}

function closeModal() {
  if (modal?.isConnected) {
    modal.remove();
  }
  modal = null;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => !isSensitiveHeaderName(key))
      .map(([key, value]) => [key, truncateText(String(value), 500)])
  );
}

function isAllowedContentType(contentType) {
  return contentType.includes("application/json") || contentType.startsWith("text/");
}

function isBlacklistedUrl(url) {
  return /(analytics|telemetry|sentry|metrics|\/log\b|\/track\b)/i.test(url);
}

function isStaticAsset(url) {
  return /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|map)(?:$|\?)/i.test(url);
}

function truncateText(value, limit) {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...[truncated]`;
}

function shortenUrl(url) {
  if (url.length <= 80) {
    return url;
  }
  return `${url.slice(0, 77)}...`;
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
        const sample = parsed[0];
        const sampleText = sample && typeof sample === "object"
          ? Object.keys(sample).slice(0, 3).join(", ")
          : truncateText(String(sample ?? ""), 40);
        return `array[${parsed.length}]${sampleText ? ` · ${sampleText}` : ""}`;
      }

      if (parsed && typeof parsed === "object") {
        const keys = Object.keys(parsed).slice(0, 4);
        const sampleValue = keys
          .map((key) => {
            const value = parsed[key];
            return typeof value === "string" || typeof value === "number"
              ? `${key}: ${truncateText(String(value), 32)}`
              : "";
          })
          .find(Boolean);
        return `object: ${keys.join(", ")}${sampleValue ? ` · ${sampleValue}` : ""}`;
      }
    } catch {
      return truncateText(text.replace(/\s+/g, " "), 110);
    }
  }

  return truncateText(text.replace(/\s+/g, " "), 110);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function isOriginArmed(armedOrigins) {
  return Boolean(armedOrigins && armedOrigins[location.origin]);
}

function isSensitiveHeaderName(name) {
  return /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i.test(String(name || ""));
}

function createChannelToken() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16)).join("");
}
