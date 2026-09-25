// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** Recursively read-only view of plain simulation data. */
export type DeepReadonly<T> = T extends (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends Set<infer E>
      ? ReadonlySet<DeepReadonly<E>>
      : T extends object
        ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
        : T;
