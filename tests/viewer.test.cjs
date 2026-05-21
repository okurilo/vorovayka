const { loadScript } = require("./load-script.cjs");

function createViewerExports() {
  return loadScript("src/viewer.js", {
    exports: [
      "buildExportPayload",
      "getSelectedApiIds",
      "buildApiSchemaExport",
      "getApiResponseSchema",
      "buildProcessExportPayload",
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

  it("parseJsonBody and buildDataShape describe response structures in OpenAPI form", () => {
    expect(viewer.parseJsonBody('{"user":{"id":1}}', "application/json")).toEqual({ user: { id: 1 } });
    expect(viewer.parseJsonBody("not json", "text/plain")).toBeNull();

    expect(viewer.buildDataShape([{ id: 1, name: "Ada" }])).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", examples: [1] },
          name: { type: "string", examples: ["Ada"] }
        }
      }
    });

    expect(viewer.buildDataShape(null)).toEqual({
      type: "null",
      examples: [null]
    });
  });

  it("buildDataShape keeps deeper nesting and more object fields before truncation", () => {
    const wideObject = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
      `field${index + 1}`,
      index + 1
    ]));
    const deepValue = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: wideObject
              }
            }
          }
        }
      }
    };

    const schema = viewer.buildDataShape(deepValue);
    expect(Object.keys(
      schema.properties.level1.properties.level2.properties.level3.properties.level4.properties.level5.properties.level6.properties
    )).toHaveLength(20);
    expect(
      schema.properties.level1.properties.level2.properties.level3.properties.level4.properties.level5.properties.level6.properties.field20
    ).toEqual({
      type: "integer",
      examples: [20]
    });
  });

  it("buildExportPayload respects selected scope", () => {
    const bundle = {
      specVersion: "widgetron.capture-bundle.v1",
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

    expect(viewer.buildExportPayload(bundle, {}, "api", new Set(["api-2"]))).toEqual({
      specVersion: "widgetron.capture-bundle.v1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      api: [bundle.api[1]]
    });

    expect(viewer.buildExportPayload(bundle, {}, "dom-clean", new Set())).toEqual({
      specVersion: "widgetron.capture-bundle.v1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      dom: {
        tagName: "div",
        selector: ".card",
        textPreview: "Visible text",
        cleanHtml: "<div>Visible text</div>"
      }
    });

    expect(viewer.buildExportPayload(bundle, {}, "all", new Set(["api-1"]))).toEqual({
      specVersion: "widgetron.capture-bundle.v1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      dom: {
        tagName: "div",
        selector: ".card",
        textPreview: "Visible text",
        cleanHtml: "<div>Visible text</div>"
      },
      apiSchema: [
        {
          id: "api-1",
          method: "GET",
          url: "https://site.test/api/users",
          status: 200,
          contentType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              users: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "integer", examples: [1] }
                  }
                }
              }
            }
          }
        }
      ]
    });
  });

  it("buildApiSchemaExport prefers schema from recipe over truncated response body", () => {
    const apiRecords = [
      {
        id: "api-1",
        method: "GET",
        url: "https://site.test/api/users",
        status: 200,
        contentType: "application/json",
        responseBody: '{"users":[{"id":1}]}...[truncated]'
      }
    ];

    const recipe = {
      apiSequence: [
        {
          requestId: "api-1",
          response: {
            shape: {
              type: "object",
              properties: {
                users: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "integer" }
                    }
                  }
                }
              }
            }
          }
        }
      ]
    };

    expect(viewer.buildApiSchemaExport(apiRecords, recipe)).toEqual([
      {
        id: "api-1",
        method: "GET",
        url: "https://site.test/api/users",
        status: 200,
        contentType: "application/json",
        responseSchema: recipe.apiSequence[0].response.shape
      }
    ]);
  });

  it("buildApiSchemaExport enriches recipe schema with OAS 3.1 examples from response body", () => {
    const apiRecords = [
      {
        id: "api-1",
        method: "GET",
        url: "https://site.test/api/users",
        status: 200,
        contentType: "application/json; charset=utf-8",
        responseBody: '{"users":[{"id":1,"name":"Ada"}]}'
      }
    ];

    const recipe = {
      apiSequence: [
        {
          requestId: "api-1",
          response: {
            shape: {
              type: "object",
              properties: {
                users: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      name: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      ]
    };

    expect(viewer.buildApiSchemaExport(apiRecords, recipe)).toEqual([
      {
        id: "api-1",
        method: "GET",
        url: "https://site.test/api/users",
        status: 200,
        contentType: "application/json; charset=utf-8",
        responseSchema: {
          type: "object",
          properties: {
            users: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer", examples: [1] },
                  name: { type: "string", examples: ["Ada"] }
                }
              }
            }
          }
        }
      }
    ]);
  });

  it("buildApiSchemaExport restores nested properties when recipe schema was truncated to empty object", () => {
    const apiRecords = [
      {
        id: "api-1",
        method: "POST",
        url: "https://site.test/youtubei/v1/guide",
        status: 200,
        contentType: "application/json; charset=utf-8",
        responseBody: JSON.stringify({
          items: [
            {
              guideSectionRenderer: {
                items: [
                  {
                    entryRenderer: {
                      label: "Home",
                      selected: true
                    }
                  }
                ],
                trackingParams: "abc123"
              }
            }
          ]
        })
      }
    ];

    const recipe = {
      apiSequence: [
        {
          requestId: "api-1",
          response: {
            shape: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      guideSectionRenderer: {
                        type: "object",
                        properties: {
                          items: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {}
                            }
                          },
                          trackingParams: {
                            type: "string"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      ]
    };

    expect(viewer.buildApiSchemaExport(apiRecords, recipe)[0].responseSchema).toEqual({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              guideSectionRenderer: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        entryRenderer: {
                          type: "object",
                          properties: {
                            label: { type: "string", examples: ["Home"] },
                            selected: { type: "boolean", examples: [true] }
                          }
                        }
                      }
                    }
                  },
                  trackingParams: {
                    type: "string",
                    examples: ["abc123"]
                  }
                }
              }
            }
          }
        }
      }
    });
  });

  it("getSelectedApiIds falls back to all api ids before checkboxes mount", () => {
    const bundle = {
      api: [
        { id: "api-1" },
        { requestId: "req-2" },
        {}
      ]
    };

    expect(Array.from(viewer.getSelectedApiIds(bundle, {
      querySelectorAll() {
        return [];
      }
    }))).toEqual(["api-1", "req-2", "2"]);

    expect(Array.from(viewer.getSelectedApiIds(bundle, {
      querySelectorAll() {
        return [
          { checked: true, dataset: { apiId: "api-1" } },
          { checked: false, dataset: { apiId: "req-2" } }
        ];
      }
    }))).toEqual(["api-1"]);
  });

  it("extractResponseShape falls back to text for non-json bodies", () => {
    expect(viewer.extractResponseShape({
      responseBody: "plain text",
      contentType: "text/plain"
    })).toEqual({
      type: "string",
      contentMediaType: "text/plain",
      examples: ["plain text"]
    });
  });

  it("buildDataShape keeps up to three compact examples and sanitizes base64 payloads", () => {
    expect(viewer.buildDataShape(["one", "two", "three", "four"])).toEqual({
      type: "array",
      items: {
        type: "string",
        examples: ["one"]
      }
    });

    expect(viewer.extractResponseShape({
      responseBody: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      contentType: "text/plain"
    })).toEqual({
      type: "string",
      contentMediaType: "text/plain",
      examples: ["base64"]
    });
  });

  it("buildExportPayload reuses stored apiSchema when raw api records are hidden", () => {
    const bundle = {
      specVersion: "widgetron.capture-bundle.v1",
      capturedAt: "2026-05-15T10:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      dom: {
        tagName: "section",
        selector: ".widget",
        textPreview: "Visible text",
        cleanHtml: "<section>Visible text</section>"
      },
      apiSchema: [
        {
          id: "api-1",
          method: "GET",
          url: "https://site.test/api/widget",
          status: 200,
          contentType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              title: { type: "string", examples: ["Visible text"] }
            }
          }
        }
      ],
      apiResolution: {
        strategy: "single-best-match",
        autoSelectedIds: ["api-1"]
      }
    };

    expect(viewer.buildExportPayload(bundle, {}, "all", new Set(["api-1"]))).toEqual({
      specVersion: "widgetron.capture-bundle.v1",
      capturedAt: "2026-05-15T10:00:00.000Z",
      page: { url: "https://site.test", title: "Demo" },
      apiResolution: {
        strategy: "single-best-match",
        autoSelectedIds: ["api-1"]
      },
      dom: {
        tagName: "section",
        selector: ".widget",
        textPreview: "Visible text",
        cleanHtml: "<section>Visible text</section>"
      },
      apiSchema: bundle.apiSchema
    });
  });

  it("buildProcessExportPayload keeps API order and response schema for LLM restore", () => {
    const payload = viewer.buildProcessExportPayload({
      processId: "process-1",
      name: "Оформление заявки",
      status: "stopped",
      origin: "https://site.test",
      startedAt: "2026-05-15T10:00:00.000Z",
      stoppedAt: "2026-05-15T10:01:00.000Z",
      page: { url: "https://site.test/form", title: "Form" },
      eventCount: 1,
      storedEventCount: 1,
      droppedEventCount: 0,
      events: [
        {
          type: "api",
          step: 1,
          calledAt: "2026-05-15T10:00:10.000Z",
          relativeToStartMs: 10000,
          page: { url: "https://site.test/form", title: "Form" },
          method: "POST",
          url: "https://site.test/api/orders",
          status: 201,
          contentType: "application/json",
          requestHeaders: { "Content-Type": "application/json" },
          requestBody: '{"itemId":1}',
          responseHeaders: { ETag: "v1" },
          responseBody: '{"id":42,"ok":true}',
          responseShape: {
            type: "object",
            properties: {
              id: { type: "integer" },
              ok: { type: "boolean" }
            }
          },
          responsePreview: "object: id, ok",
          initiatorStack: "stack"
        }
      ]
    });

    expect(payload).toEqual({
      specVersion: "widgetron.process-export.v1",
      exportProfile: "llm-compact",
      process: {
        id: "process-1",
        name: "Оформление заявки",
        status: "stopped",
        origin: "https://site.test",
        startedAt: "2026-05-15T10:00:00.000Z",
        stoppedAt: "2026-05-15T10:01:00.000Z",
        page: { url: "https://site.test/form", title: "Form" },
        eventCount: 1,
        storedEventCount: 1,
        droppedEventCount: 0
      },
      omittedFromCompactExport: {
        requestHeaders: true,
        responseHeaders: true,
        responseBodies: true,
        initiatorStacks: true,
        note: "Full local details remain in the process viewer; this export is sized for LLM context."
      },
      limits: {
        requestBodyChars: 1600,
        urlChars: 1200,
        jsonDepth: 5,
        jsonProperties: 24,
        jsonArrayItems: 8
      },
      apiFlow: [
        {
          step: 1,
          calledAt: "2026-05-15T10:00:10.000Z",
          relativeToStartMs: 10000,
          request: {
            method: "POST",
            url: "https://site.test/api/orders",
            body: '{"itemId":1}'
          },
          response: {
            status: 201,
            contentType: "application/json",
            preview: "object: id, ok",
            schema: {
              type: "object",
              properties: {
                id: { type: "integer", examples: [42] },
                ok: { type: "boolean", examples: [true] }
              }
            },
            bodyOmitted: true
          }
        }
      ]
    });
  });

  it("buildProcessExportPayload trims large process details for LLM context", () => {
    const payload = viewer.buildProcessExportPayload({
      processId: "process-2",
      name: "Большой процесс",
      origin: "https://site.test",
      events: [
        {
          type: "api",
          step: 1,
          method: "POST",
          url: `https://site.test/api/search?${Array.from({ length: 12 }, (_, index) => `param${index}=value-${"x".repeat(200)}`).join("&")}`,
          status: 200,
          contentType: "application/json",
          requestHeaders: { Authorization: "secret", "Content-Type": "application/json" },
          requestBody: JSON.stringify({
            items: Array.from({ length: 20 }, (_, index) => ({ id: index + 1, text: "x".repeat(400) }))
          }),
          responseHeaders: { ETag: "v1" },
          responseBody: JSON.stringify({ rows: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) }),
          responsePreview: "object: rows",
          initiatorStack: "stack".repeat(1000)
        }
      ]
    });

    expect(payload.apiFlow[0].request.url.length).toBeLessThanOrEqual(1200);
    expect(payload.apiFlow[0].request.body.length).toBeLessThanOrEqual(1600);
    expect(payload.apiFlow[0].request.headers).toBeUndefined();
    expect(payload.apiFlow[0].request.initiatorStack).toBeUndefined();
    expect(payload.apiFlow[0].response.headers).toBeUndefined();
    expect(payload.apiFlow[0].response.body).toBeUndefined();
    expect(payload.apiFlow[0].response.bodyOmitted).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("Authorization");
    expect(JSON.stringify(payload)).not.toContain("stackstack");
  });
});


