// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { EXTERNAL_LINKS } from '../shared/protocol.ts';
import { api } from './api.ts';

const [SOURCE, GPL, FACTBOOK] = EXTERNAL_LINKS;

function Link({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void api.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

export function About() {
  const { electron, chrome, node } = api.versions;
  return (
    <section className="panel about">
      <h2>About Nationwright</h2>
      <p>Copyright © 2026 Nexxus Drako Multimedia.</p>
      <p>
        Nationwright is free software: you can redistribute it and/or modify it under the terms of
        the GNU General Public License as published by the Free Software Foundation, either version
        3 of the License, or (at your option) any later version. It is distributed in the hope that
        it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
        MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
      </p>
      <ul className="links">
        <li>
          <Link href={GPL}>GNU General Public License, version 3</Link>
        </li>
        <li>
          <Link href={SOURCE}>Source code</Link>
        </li>
      </ul>
      <h3>Data</h3>
      <p>
        Every country in Nationwright is fictional. Their statistics are drawn from distributions
        fitted to the World Factbook, via the public-domain (CC0){' '}
        <Link href={FACTBOOK}>factbook.json</Link> project.
      </p>
      <p className="versions">
        Electron {electron} · Chromium {chrome} · Node.js {node}
      </p>
    </section>
  );
}
