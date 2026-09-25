// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import type { NationwrightApi } from '../shared/protocol.ts';

declare global {
  interface Window {
    readonly nationwright: NationwrightApi;
  }
}

export const api: NationwrightApi = window.nationwright;
