const { loadScript } = require("./load-script.cjs");

function createDocumentStub() {
  return {
    documentElement: {},
    body: {},
    addEventListener() {},
    createElement() {
      return {
        dataset: {},
        remove() {},
        setAttribute() {},
        appendChild() {}
      };
    }
  };
}

function createContentExports() {
  return loadScript("src/content.js", {
    exports: [
      "normalizeNetworkRecord",
      "sanitizeHeaders",
      "buildResponsePreview",
      "formatCandidateMatchPercent",
      "formatCandidateRequestTitle",
      "formatCandidateRequestSummary",
      "truncateText",
      "resolveApiSelection",
      "buildApiResolution"
    ],
    replacements: [["void initializeCapture();", ""]],
    globals: {
      window: { addEventListener() {}, setTimeout, clearTimeout },
      document: createDocumentStub(),
      location: { origin: "https://example.com", href: "https://example.com/page" },
      chrome: {
        runtime: { onMessage: { addListener() {} }, getURL(path) { return path; } },
        storage: { onChanged: { addListener() {} }, local: { get: async () => ({}) } }
      },
      crypto: {
        getRandomValues(values) {
          values.fill(1);
          return values;
        }
      },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      Element: class {},
      NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 0, FILTER_ACCEPT: 1 }
    }
  });
}

describe("content capture helpers", () => {
  let content;

  beforeEach(() => {
    content = createContentExports();
  });

  it("normalizeNetworkRecord drops irrelevant requests", () => {
    expect(content.normalizeNetworkRecord({ url: "https://site.test/app.js", method: "GET", contentType: "text/javascript" })).toBeNull();
    expect(content.normalizeNetworkRecord({ url: "https://site.test/log", method: "POST", contentType: "application/json" })).toBeNull();
    expect(content.normalizeNetworkRecord({ url: "https://site.test/api", method: "OPTIONS", contentType: "application/json" })).toBeNull();
    expect(content.normalizeNetworkRecord({ url: "https://site.test/api", method: "GET", contentType: "image/png" })).toBeNull();
  });

  it("normalizeNetworkRecord keeps allowed payloads and strips sensitive headers", () => {
    const record = content.normalizeNetworkRecord({
      id: "req-1",
      url: "https://site.test/api/users",
      method: "post",
      status: 201,
      timestamp: 123,
      contentType: "application/json; charset=utf-8",
      requestBody: "x".repeat(25000),
      responseBody: JSON.stringify({ ok: true }),
      requestHeaders: {
        Authorization: "secret",
        "Content-Type": "application/json"
      },
      responseHeaders: {
        "Set-Cookie": "hidden",
        ETag: "v1"
      }
    });

    expect(record).toMatchObject({
      id: "req-1",
      method: "POST",
      status: 201,
      contentType: "application/json; charset=utf-8"
    });
    expect(record.requestHeaders).toEqual({ "Content-Type": "application/json" });
    expect(record.responseHeaders).toEqual({ ETag: "v1" });
    expect(record.requestBody.endsWith("...[truncated]")).toBe(true);
  });

  it("buildResponsePreview summarizes json and plain text responses", () => {
    expect(content.buildResponsePreview('[{"id":1,"name":"Ada"}]', "application/json")).toBe("array[1] · id, name");
    expect(content.buildResponsePreview('{"id":1,"name":"Ada"}', "application/json")).toContain("object:");
    expect(content.buildResponsePreview("plain text response", "text/plain")).toBe("plain text response");
  });

  it("formatCandidateMatchPercent maps score to bounded percentage", () => {
    expect(content.formatCandidateMatchPercent(26)).toBe(100);
    expect(content.formatCandidateMatchPercent(13)).toBe(50);
    expect(content.formatCandidateMatchPercent(-5)).toBe(0);
    expect(content.formatCandidateMatchPercent(40)).toBe(100);
  });

  it("formats long request urls into compact title and useful param summary", () => {
    const url = "https://www.youtube.com/api/timedtext?v=inQuNn3eggk&ei=hokDapu-ILbN-_UPw7D76A8&hl=ru&fmt=json3&kind=asr&c=WEB";
    expect(content.formatCandidateRequestTitle("get", url)).toBe("GET www.youtube.com/api/timedtext");
    expect(content.formatCandidateRequestSummary(url)).toBe("Параметры: v=inQuNn3eggk · hl=ru · fmt=json3 · kind=asr · ещё 2");
  });

  it("resolveApiSelection picks a confident single winner", () => {
    const result = content.resolveApiSelection([
      {
        id: "api-1",
        score: 21,
        timestamp: 2,
        analysis: { strongBindingCount: 2, visibleMatchCount: 1, evidenceCount: 1 }
      },
      {
        id: "api-2",
        score: 13,
        timestamp: 1,
        analysis: { strongBindingCount: 0, visibleMatchCount: 0, evidenceCount: 0 }
      }
    ]);

    expect(result.strategy).toBe("single-best-match");
    expect(result.requiresManualChoice).toBe(false);
    expect(result.autoSelectedIds).toEqual(["api-1"]);
  });

  it("resolveApiSelection keeps multiple strong sources when widget depends on several apis", () => {
    const result = content.resolveApiSelection([
      {
        id: "api-1",
        score: 24,
        timestamp: 3,
        method: "GET",
        url: "https://site.test/api/one",
        analysis: { strongBindingCount: 1, visibleMatchCount: 1, evidenceCount: 1 },
        reasons: { factMatchCount: 2 }
      },
      {
        id: "api-2",
        score: 22,
        timestamp: 2,
        method: "GET",
        url: "https://site.test/api/two",
        analysis: { strongBindingCount: 1, visibleMatchCount: 1, evidenceCount: 0 },
        reasons: { factMatchCount: 2 }
      },
      {
        id: "api-3",
        score: 21.5,
        timestamp: 1,
        method: "GET",
        url: "https://site.test/api/three",
        analysis: { strongBindingCount: 1, visibleMatchCount: 0, evidenceCount: 0 },
        reasons: { factMatchCount: 1 }
      }
    ]);

    expect(result.strategy).toBe("multi-source");
    expect(result.requiresManualChoice).toBe(false);
    expect(result.autoSelectedIds).toEqual(["api-1", "api-2", "api-3"]);
  });

  it("resolveApiSelection asks for manual review when leaders are too close", () => {
    const result = content.resolveApiSelection([
      {
        id: "api-1",
        score: 16,
        timestamp: 2,
        method: "GET",
        url: "https://site.test/api/one",
        analysis: { strongBindingCount: 0, visibleMatchCount: 1, evidenceCount: 0 },
        reasons: { factMatchCount: 1 }
      },
      {
        id: "api-2",
        score: 15,
        timestamp: 1,
        method: "GET",
        url: "https://site.test/api/two",
        analysis: { strongBindingCount: 0, visibleMatchCount: 1, evidenceCount: 0 },
        reasons: { factMatchCount: 1 }
      }
    ]);

    expect(result.strategy).toBe("manual-review");
    expect(result.requiresManualChoice).toBe(true);
    expect(result.selectedCandidates.map((item) => item.id)).toEqual(["api-1", "api-2"]);
  });
});
