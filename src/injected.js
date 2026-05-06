(() => {
  const EVENT_NAME = document.currentScript?.dataset.eventName || "__VOROVAYKA_NETWORK_EVENT__";
  const MAX_REQUEST_CHARS = 20 * 1024;
  const MAX_RESPONSE_CHARS = 512 * 1024;
  const MAX_BUFFERED_BODY_BYTES = 512 * 1024;
  const MAX_STACK_CHARS = 8 * 1024;
  const FETCH_WRAPPER_MARK = "__vorovaykaFetchWrapper__";
  const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|session|csrf|xsrf|api[-_]?key|jwt)/i;
  const encoder = new TextEncoder();
  let seq = 0;

  if (window.__vorovaykaInjected) {
    return;
  }
  window.__vorovaykaInjected = true;

  const upstreamFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  if (typeof upstreamFetch === "function" && !upstreamFetch[FETCH_WRAPPER_MARK]) {
    const composedFetch = async function vorovaykaFetchWrapper(input, init) {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = String(init?.method || request?.method || "GET").toUpperCase();
      const timestamp = Date.now();
      const requestHeaders = sanitizeHeaders(extractHeaders(init?.headers || request?.headers));
      const requestBody = serializeRequestBody(init?.body);
      const initiatorStack = captureStack();

      const response = await upstreamFetch.apply(this, arguments);

      queueMicrotask(() => {
        void captureFetchResponse(response, {
          url,
          method,
          timestamp,
          requestHeaders,
          requestBody,
          initiatorStack
        });
      });

      return response;
    };

    Object.defineProperty(composedFetch, FETCH_WRAPPER_MARK, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    window.fetch = composedFetch;
  }

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__vorovaykaMeta = {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
      timestamp: 0,
      requestHeaders: {}
    };
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
    if (this.__vorovaykaMeta) {
      this.__vorovaykaMeta.requestHeaders[name] = value;
    }
    return originalXhrSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend() {
    if (this.__vorovaykaMeta) {
      this.__vorovaykaMeta.timestamp = Date.now();
      this.__vorovaykaMeta.requestBody = serializeRequestBody(arguments[0]);
      this.__vorovaykaMeta.initiatorStack = captureStack();
      this.addEventListener("loadend", () => {
        const meta = this.__vorovaykaMeta || {};
        emit(buildXhrPayload(this, meta));
      }, { once: true });
    }
    return originalXhrSend.apply(this, arguments);
  };

  async function captureFetchResponse(response, meta) {
    try {
      const payload = await buildFetchPayload(response, meta);
      if (payload) {
        emit(payload);
      }
    } catch {
      // Capture is best-effort and must never affect the page fetch chain.
    }
  }

  async function buildFetchPayload(response, meta) {
    let clone;
    try {
      clone = response.clone();
    } catch {
      return null;
    }

    const contentType = clone.headers.get("content-type") || "";
    if (!isAllowedContentType(contentType)) {
      return null;
    }

    const responseHeaders = sanitizeHeaders(extractHeaders(clone.headers));
    let responseBody = "";
    let bodyTooLarge = false;

    try {
      const text = await clone.text();
      bodyTooLarge = encoder.encode(text).length > MAX_BUFFERED_BODY_BYTES;
      responseBody = truncate(sanitizeResponseBody(text, contentType), MAX_RESPONSE_CHARS);
    } catch {
      responseBody = "";
    }

    return {
      id: nextId(),
      url: meta.url,
      method: meta.method,
      status: response.status,
      timestamp: meta.timestamp,
      contentType,
      requestBody: meta.requestBody,
      initiatorStack: meta.initiatorStack,
      responseBody,
      bodyTooLarge,
      requestHeaders: meta.requestHeaders,
      responseHeaders
    };
  }

  function buildXhrPayload(xhr, meta) {
    const responseHeaders = sanitizeHeaders(parseHeaderString(xhr.getAllResponseHeaders()));
    const contentType = xhr.getResponseHeader("content-type") || "";
    const responseText = readXhrText(xhr);
    const bodyTooLarge = encoder.encode(responseText).length > MAX_BUFFERED_BODY_BYTES;

    return {
      id: nextId(),
      url: meta.url,
      method: meta.method,
      status: xhr.status,
      timestamp: meta.timestamp || Date.now(),
      contentType,
      requestBody: meta.requestBody || "",
      initiatorStack: meta.initiatorStack || "",
      responseBody: isAllowedContentType(contentType)
        ? truncate(sanitizeResponseBody(responseText, contentType), MAX_RESPONSE_CHARS)
        : "",
      bodyTooLarge,
      requestHeaders: sanitizeHeaders(meta.requestHeaders),
      responseHeaders
    };
  }

  function emit(payload) {
    window.postMessage({
      type: EVENT_NAME,
      payload
    }, "*");
  }

  function readXhrText(xhr) {
    try {
      return typeof xhr.responseText === "string" ? xhr.responseText : "";
    } catch {
      return "";
    }
  }

  function nextId() {
    seq += 1;
    return `net-${Date.now()}-${seq}`;
  }

  function extractHeaders(input) {
    if (!input) {
      return {};
    }
    if (input instanceof Headers) {
      return Object.fromEntries(input.entries());
    }
    if (Array.isArray(input)) {
      return Object.fromEntries(input);
    }
    return { ...input };
  }

  function parseHeaderString(value) {
    return String(value || "")
      .trim()
      .split(/[\r\n]+/)
      .filter(Boolean)
      .reduce((acc, line) => {
        const index = line.indexOf(":");
        if (index <= 0) {
          return acc;
        }
        const key = line.slice(0, index).trim();
        const headerValue = line.slice(index + 1).trim();
        acc[key] = headerValue;
        return acc;
      }, {});
  }

  function captureStack() {
    try {
      const stack = new Error().stack || "";
      return truncate(redactSensitiveText(stack), MAX_STACK_CHARS);
    } catch {
      return "";
    }
  }

  function serializeRequestBody(body) {
    if (body == null) {
      return "";
    }

    try {
      if (typeof body === "string") {
        return truncate(sanitizeBodyText(body), MAX_REQUEST_CHARS);
      }

      if (body instanceof URLSearchParams) {
        return truncate(JSON.stringify(redactSensitiveFields(Object.fromEntries(body.entries()))), MAX_REQUEST_CHARS);
      }

      if (body instanceof FormData) {
        return truncate(JSON.stringify(redactFormData(body)), MAX_REQUEST_CHARS);
      }

      if (body instanceof Blob) {
        return `[Blob ${body.type || "unknown"} ${body.size} bytes]`;
      }

      if (body instanceof ArrayBuffer) {
        return `[ArrayBuffer ${body.byteLength} bytes]`;
      }

      if (ArrayBuffer.isView(body)) {
        return `[${body.constructor?.name || "TypedArray"} ${body.byteLength} bytes]`;
      }

      return truncate(redactSensitiveText(String(body)), MAX_REQUEST_CHARS);
    } catch {
      return "";
    }
  }

  function sanitizeBodyText(text) {
    try {
      return JSON.stringify(redactSensitiveFields(JSON.parse(text)));
    } catch {
      return redactSensitiveText(text);
    }
  }

  function redactFormData(formData) {
    const safeEntries = {};

    for (const [key, value] of formData.entries()) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        safeEntries[key] = "[REDACTED]";
        continue;
      }

      if (typeof File !== "undefined" && value instanceof File) {
        safeEntries[key] = `[File ${value.name || "unnamed"} ${value.type || "unknown"} ${value.size} bytes]`;
        continue;
      }

      safeEntries[key] = String(value);
    }

    return redactSensitiveFields(safeEntries);
  }

  function sanitizeHeaders(headers) {
    return Object.fromEntries(
      Object.entries(headers || {})
        .filter(([key]) => !isSensitiveHeaderName(key))
        .map(([key, value]) => [key, String(value)])
    );
  }

  function sanitizeResponseBody(text, contentType) {
    if (!text) {
      return "";
    }

    if (String(contentType || "").toLowerCase().includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(redactSensitiveFields(parsed));
      } catch {
        return redactSensitiveText(text);
      }
    }

    return redactSensitiveText(text);
  }

  function redactSensitiveFields(value) {
    if (Array.isArray(value)) {
      return value.map(redactSensitiveFields);
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, redactSensitiveFields(entryValue)];
      })
    );
  }

  function redactSensitiveText(text) {
    return String(text)
      .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[REDACTED]")
      .replace(/((?:token|secret|password|api[_-]?key|session|csrf|xsrf)\s*[:=]\s*)([^\s,;&]+)/gi, "$1[REDACTED]")
      .replace(/((?:authorization|cookie)\s*[:=]\s*)([^\n]+)/gi, "$1[REDACTED]");
  }

  function isSensitiveHeaderName(name) {
    return /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i.test(String(name || ""));
  }

  function isAllowedContentType(contentType) {
    const value = String(contentType || "").toLowerCase();
    return value.includes("application/json") || value.startsWith("text/");
  }

  function truncate(value, limit) {
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit)}\n...[truncated]`;
  }
})();
