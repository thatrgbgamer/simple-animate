#!/usr/bin/env node
/**
 * Lightweight sanity check: every source file parses, the views exist, each
 * page carries the thatRGB button, and the bundled encoder is present.
 * Run with `npm run check`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let failures = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]
  .filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));

for (const file of files) {
  const isModule = file.includes(`${path.sep}renderer${path.sep}`) || file.endsWith('.mjs');
  try {
    if (isModule) {
      // node --check detects ES module syntax on its own.
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } else {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    }
  } catch (error) {
    const message = error.stderr ? error.stderr.toString().trim().split('\n')[0] : error.message;
    console.error(`✗ ${path.relative(root, file)}: ${message}`);
    failures++;
  }
}

const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');

for (const id of ['view-home', 'view-editor', 'view-export', 'view-about', 'view-shortcuts']) {
  if (!html.includes(`id="${id}"`)) {
    console.error(`✗ index.html is missing #${id}`);
    failures++;
  }
}

// Every page needs the thatrgb.website button in its top bar.
for (const view of html.split('<section class="view"').slice(1)) {
  const id = (view.match(/id="([^"]+)"/) || [])[1];
  const topbar = view.split('</header>')[0];
  if (!topbar.includes('data-site-link')) {
    console.error(`✗ ${id} has no thatRGB button in its top bar`);
    failures++;
  }
}

try {
  const ffmpeg = require('ffmpeg-static');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    console.error('✗ the ffmpeg-static binary is missing — run npm install');
    failures++;
  }
} catch (error) {
  console.error('✗ ffmpeg-static is not installed — run npm install');
  failures++;
}

if (failures) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log(`✓ ${files.length} source files parsed, all views carry the thatRGB button, encoder present.`);
