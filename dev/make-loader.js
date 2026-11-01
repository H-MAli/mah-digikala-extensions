// Builds dev/loader.user.js: a small Tampermonkey script that loads the main script straight
// from this folder, so every saved change shows up on the next page reload.
// The loader copies the main script's header (grants, @connect, @match), so run this again
// whenever that header changes.  Usage: node dev/make-loader.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const main = path.resolve(__dirname, '..', 'mah-digikala.extensions.user.js');
const out = path.join(__dirname, 'loader.user.js');

const src = fs.readFileSync(main, 'utf8');
const header = src.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
if (!header) throw new Error('No userscript header found in ' + main);

const lines = header[0].split(/\r?\n/)
  .filter((l) => !/^\/\/ @(updateURL|downloadURL)\b/.test(l))
  .map((l) => l
    .replace(/^(\/\/ @name\s+)(.*)$/, '$1$2 (dev)')
    .replace(/^(\/\/ @name:fa\s+)(.*)$/, '$1$2 (توسعه)')
    .replace(/^(\/\/ @version\s+)(.*)$/, '$1$2-dev'));
lines.splice(lines.length - 1, 0, '// @require      ' + pathToFileURL(main).href);

fs.writeFileSync(out, lines.join('\n') + '\n');
console.log('Wrote ' + out);
