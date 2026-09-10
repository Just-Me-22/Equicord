/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { cache } from "@webpack";

/** discord builds its class names as <name>_<hash> or <name>__<hash>, where the name is
 *  what the source stylesheet called the thing and the hash changes on every build. */
const CLASS = /^([A-Za-z][A-Za-z0-9$]*)_{1,2}([0-9a-f]{5,6})$/;

export interface ClassMap {
    /** "message__5126c" to "message" */
    name: Map<string, string>;
    /** "message" to every class currently carrying that name */
    hash: Map<string, string[]>;
    modules: number;
    classes: number;
    ms: number;
}

let map: ClassMap | null = null;

function harvest(exports: object, name: Map<string, string>, hash: Map<string, string[]>) {
    for (const key in exports) {
        const value = (exports as Record<string, unknown>)[key];
        if (typeof value !== "string" || value.length > 200) continue;

        // a css module value can hold several composed classes
        for (const token of value.split(" ")) {
            const hit = CLASS.exec(token);
            if (!hit || name.has(token)) continue;

            name.set(token, hit[1]);
            const carrying = hash.get(hit[1]);
            if (carrying) carrying.push(token);
            else hash.set(hit[1], [token]);
        }
    }
}

/** walks the modules discord has already loaded and collects every class name in them.
 *
 *  the module cache rather than the factory list: reading the factories would mean
 *  running every module in the client, which is slow and has side effects. the cache
 *  only holds what discord has loaded, so the map covers what is on screen and grows
 *  as more of the app is used. */
export function build(): ClassMap {
    const started = performance.now();
    const name = new Map<string, string>();
    const hash = new Map<string, string[]>();
    let modules = 0;

    for (const id in cache) {
        const { exports } = cache[id];
        if (!exports || (typeof exports !== "object" && typeof exports !== "function")) continue;

        modules++;
        // webpack exports carry getters, and some of discord's throw when read
        try {
            harvest(exports, name, hash);
            const inner = (exports as { default?: unknown; }).default;
            if (inner && typeof inner === "object") harvest(inner, name, hash);
        } catch { }
    }

    map = { name, hash, modules, classes: name.size, ms: performance.now() - started };
    return map;
}

export function current(): ClassMap {
    return map ?? build();
}

/** what an element's classes are called, in the order they sit on the element. the stem
 *  is the token without its hash, which is the half that survives a discord build. */
export function read(el: Element): { token: string; name: string | null; stem: string; }[] {
    const { name } = current();
    return Array.from(el.classList, token => ({
        token,
        name: name.get(token) ?? null,
        stem: token.replace(/[0-9a-f]{5,6}$/, "")
    }));
}

/** every class whose name contains the query, best matches first */
export function search(query: string, limit = 40): { name: string; tokens: string[]; }[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return [];

    const hits: { name: string; tokens: string[]; }[] = [];
    for (const [name, tokens] of current().hash) {
        if (name.toLowerCase().includes(wanted)) hits.push({ name, tokens });
    }

    return hits
        .sort((a, b) => {
            const rank = Number(b.name.toLowerCase().startsWith(wanted)) - Number(a.name.toLowerCase().startsWith(wanted));
            return rank || a.name.length - b.name.length || a.name.localeCompare(b.name);
        })
        .slice(0, limit);
}
