const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadScript(relativePath, options = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  let source = fs.readFileSync(filePath, "utf8");

  for (const [search, replace] of options.replacements || []) {
    source = source.replace(search, replace);
  }

  source += `\n;globalThis.__testExports = { ${options.exports.join(", ")} };`;

  const context = vm.createContext({
    console,
    URL,
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout,
    ...options.globals
  });

  vm.runInContext(source, context, { filename: filePath });
  return context.__testExports;
}

module.exports = {
  loadScript
};
