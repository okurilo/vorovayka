const { loadScript } = require("./load-script.cjs");

function createViewerExports() {
  return loadScript("src/viewer.js", {
    exports: [
      "buildExportPayload",
      "getSelectedApiIds",
      "buildApiSchemaExport",
      "getApiResponseSchema",
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
});


