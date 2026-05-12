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
      "truncateText"
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
});
