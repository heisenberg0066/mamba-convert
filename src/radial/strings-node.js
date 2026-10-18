'use strict';
// Main-process access to the radial strings (same table as the renderer).
const vm = require('vm'); const fs = require('fs'); const path = require('path');
let table = null;
module.exports = (lang, key) => {
  if (!table) { const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'strings.js'), 'utf8'), sb); table = sb.window.RSTR; }
  return (table[lang] || {})[key] || table.en[key] || key;
};
