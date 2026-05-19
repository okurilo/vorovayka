const { loadScript } = require("./load-script.cjs");

function createElementStub() {
  return {
    textContent: "",
    innerHTML: "",
    checked: false,
    disabled: false,
    hidden: false,
    className: "",
    dataset: {},
    addEventListener() {},
    appendChild() {},
    querySelectorAll() {
      return [];
    }
  };
}

function createPopupExports() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createElementStub());
    }
    return elements.get(id);
  };

  const popup = loadScript("src/popup.js", {
    exports: ["renderState", "setPopupStateForTest"],
    replacements: [["void refreshState();", ""]],
    globals: {
      chrome: {
        runtime: { sendMessage: async () => ({ ok: true }) },
        storage: { local: { get: async () => ({}) } }
      },
      document: {
        getElementById(id) {
          return get(id);
        }
      },
      navigator: { clipboard: { writeText: async () => {} } },
      window: { close() {} }
    }
  });

  return {
    ...popup,
    elements
  };
}

describe("popup mode rendering", () => {
  it("shows normal mode as default and hides pro actions", () => {
    const popup = createPopupExports();
    popup.setPopupStateForTest({
      isSupportedPage: true,
      isArmed: true,
      captureMode: "normal",
      hasAnyCapture: false,
      hasLatestCapture: false,
      hasCopyableCapture: false,
      origin: "https://example.com",
      captureSummary: null
    });

    popup.renderState();

    expect(popup.elements.get("modeNormal").checked).toBe(true);
    expect(popup.elements.get("modePro").checked).toBe(false);
    expect(popup.elements.get("summaryPanel").hidden).toBe(true);
    expect(popup.elements.get("viewerButton").hidden).toBe(true);
    expect(popup.elements.get("copyButton").hidden).toBe(true);
    expect(popup.elements.get("clearButton").hidden).toBe(true);
    expect(popup.elements.get("startButton").textContent).toBe("Выбрать элемент");
    expect(popup.elements.get("status").textContent).toBe("Теперь выберите нужный блок.");
  });

  it("shows pro actions when pro mode is active", () => {
    const popup = createPopupExports();
    popup.setPopupStateForTest({
      isSupportedPage: true,
      isArmed: true,
      captureMode: "pro",
      hasAnyCapture: true,
      hasLatestCapture: true,
      hasCopyableCapture: true,
      origin: "https://example.com",
      captureSummary: {
        tagName: "div",
        textPreview: "demo",
        apiCount: 2,
        capturedAt: "2026-05-15T10:00:00.000Z"
      }
    });

    popup.renderState();

    expect(popup.elements.get("modePro").checked).toBe(true);
    expect(popup.elements.get("summaryPanel").hidden).toBe(false);
    expect(popup.elements.get("viewerButton").hidden).toBe(false);
    expect(popup.elements.get("copyButton").hidden).toBe(false);
    expect(popup.elements.get("clearButton").hidden).toBe(false);
    expect(popup.elements.get("startButton").textContent).toBe("Выбрать элемент");
    expect(popup.elements.get("status").textContent).toBe("Сбор включён для этого сайта.");
  });
});
