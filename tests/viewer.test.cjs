const { loadScript } = require("./load-script.cjs");

function createViewerExports() {
  return loadScript("src/viewer.js", {
    exports: [
      "buildExportPayload",
      "buildApiTypesExport",
      "parseJsonBody",
      "buildDataShape",
      "extractResponseShape"
    ],
    replacements: [["init();", ""]],
    globals: {
      chrome: { storage: { onChanged: { addListener() {} }, local: { get: async () => ({}) } } },
      document: {
        getElementById() {
          return { innerHTML: "", textContent: "", appendChild() {}, onchange: null };
        },
        querySelector() {
          return null;
        },
        createElement() {
          return {
            className: "",
            innerHTML: "",
            textContent: "",
            open: false,
            dataset: {},
            append() {},
            appendChild() {},
            addEventListener() {},
            setAttribute() {}
          };
        }
      },
      navigator: { clipboard: { writeText: async () => {} } }
    }
  });
}

describe("viewer export helpers", () => {
  let viewer;

  beforeEach(() => {
    viewer = createViewerExports();
  });

  it("parseJsonBody and buildDataShape describe response structures", () => {
    expect(viewer.parseJsonBody('{"user":{"id":1}}', "application/json")).toEqual({ user: { id: 1 } });
    expect(viewer.parseJsonBody("not json", "text/plain")).toBeNull();

    expect(viewer.buildDataShape([{ id: 1, name: "Ada" }])).toEqual({
      type: "array",
      length: 1,
      item: {
        type: "object",
        keys: {
          id: { type: "number", example: "1" },
          name: { type: "string", example: "Ada" }
        }
      }
    });
  });

  it("buildExportPayload respects selected scope", () => {
    const bundle = {
      specVersion: "vorovayka.capture-bundle.v1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      dom: {
        tagName: "div",
        selector: ".card",
        textPreview: "Visible text",
        cleanHtml: "<div>Visible text</div>",
        rawHtml: "<div class='card'>Visible text</div>"
      },
      api: [
        {
          id: "api-1",
          method: "GET",
          url: "https://site.test/api/users",
          status: 200,
          contentType: "application/json",
          responseBody: '{"users":[{"id":1}]}'
        },
        {
          id: "api-2",
          method: "GET",
          url: "https://site.test/api/teams",
          status: 200,
          contentType: "application/json",
          responseBody: '{"teams":[{"id":2}]}'
        }
      ]
    };

    expect(viewer.buildExportPayload(bundle, "api", new Set(["api-2"]))).toEqual({
      specVersion: "vorovayka.capture-bundle.v1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      api: [bundle.api[1]]
    });

    expect(viewer.buildExportPayload(bundle, "dom-clean", new Set())).toEqual({
      specVersion: "vorovayka.capture-bundle.v1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      dom: {
        tagName: "div",
        selector: ".card",
        textPreview: "Visible text",
        cleanHtml: "<div>Visible text</div>"
      }
    });

    expect(viewer.buildExportPayload(bundle, "all", new Set(["api-1"]))).toEqual({
      specVersion: "vorovayka.capture-bundle.v1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      dom: {
        tagName: "div",
        selector: ".card",
        textPreview: "Visible text",
        cleanHtml: "<div>Visible text</div>"
      },
      apiTypes: [
        {
          id: "api-1",
          method: "GET",
          url: "https://site.test/api/users",
          status: 200,
          contentType: "application/json",
          responseType: {
            type: "object",
            keys: {
              users: {
                type: "array",
                length: 1,
                item: {
                  type: "object",
                  keys: {
                    id: { type: "number", example: "1" }
                  }
                }
              }
            }
          }
        }
      ]
    });
  });

  it("extractResponseShape falls back to text for non-json bodies", () => {
    expect(viewer.extractResponseShape({
      responseBody: "plain text",
      contentType: "text/plain"
    })).toEqual({
      type: "text",
      preview: "plain text"
    });
  });
});
