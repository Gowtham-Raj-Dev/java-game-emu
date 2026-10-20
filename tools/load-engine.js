// Loads the browser engine scripts into Node (they attach to globalThis.KP).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dir = path.join(__dirname, '..', 'web', 'engine');
module.exports = function load(files) {
  for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });
  return globalThis.KP;
};
