'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolves the bundled ffmpeg binary.
 *
 * ffmpeg-static points at a file inside the app bundle. Once the app is packed
 * into app.asar that path is not executable, so electron-builder unpacks the
 * module (see asarUnpack in electron-builder.yml) and we rewrite the path.
 */
function resolveFfmpegPath() {
  let binary;
  try {
    binary = require('ffmpeg-static');
  } catch (err) {
    return null;
  }
  if (!binary) return null;

  if (binary.includes('app.asar' + path.sep) || binary.includes('app.asar/')) {
    const unpacked = binary
      .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
      .replace('app.asar/', 'app.asar.unpacked/');
    if (fs.existsSync(unpacked)) binary = unpacked;
  }

  if (!fs.existsSync(binary)) return null;

  // Packaging can drop the executable bit on macOS/Linux.
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(binary, fs.constants.X_OK);
    } catch (err) {
      try {
        fs.chmodSync(binary, 0o755);
      } catch (chmodErr) {
        /* best effort — the spawn error below will explain the problem */
      }
    }
  }

  return binary;
}

module.exports = { resolveFfmpegPath };
