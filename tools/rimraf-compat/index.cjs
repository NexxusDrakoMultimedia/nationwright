// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The rimraf 2 API, as used by `temp`: `rimraf(path, [options], callback)` and
 * `rimraf.sync(path, [options])`. Paths are literal (no globbing); `maxBusyTries` maps to
 * fs.rm's `maxRetries`.
 */

'use strict';

const fs = require('node:fs');

function rmOptions(options) {
  const retries = options?.maxBusyTries;
  return {
    recursive: true,
    force: true,
    ...(retries === undefined ? {} : { maxRetries: retries }),
  };
}

function rimraf(path, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  fs.rm(path, rmOptions(options), (error) => callback(error ?? null));
}

rimraf.sync = (path, options) => fs.rmSync(path, rmOptions(options));

module.exports = rimraf;
