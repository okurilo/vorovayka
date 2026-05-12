const { loadScript } = require("./load-script.cjs");

function createBackgroundExports() {
  return loadScript("src/background.js", {
    exports: ["getOrigin", "isPlainObject"],
    replacements: [["initialize();", ""]],
    globals: {
      chrome: {
        tabs: {
          onActivated: { addListener() {} },
          onUpdated: { addListener() {} }
        },
        commands: { onCommand: { addListener() {} } },
        alarms: { onAlarm: { addListener() {} } },
        runtime: {
          onStartup: { addListener() {} },
          onInstalled: { addListener() {} },
          onMessage: { addListener() {} }
        }
      }
    }
  });
}

describe("background helpers", () => {
  const { getOrigin, isPlainObject } = createBackgroundExports();

  it("getOrigin returns origin only for http and https urls", () => {
    expect(getOrigin("https://example.com/path?q=1")).toBe("https://example.com");
    expect(getOrigin("http://localhost:3000/test")).toBe("http://localhost:3000");
    expect(getOrigin("chrome-extension://abc/page.html")).toBeNull();
    expect(getOrigin("not-a-url")).toBeNull();
  });

  it("isPlainObject excludes arrays and null", () => {
    expect(isPlainObject({ ok: true })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});
