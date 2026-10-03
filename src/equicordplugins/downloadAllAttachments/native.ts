/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

const ALLOWED_HOSTS = /^(?:images-ext-\d+\.discordapp\.net|media\.tenor\.com|(?:media\d?|i)\.giphy\.com|pbs\.twimg\.com|video\.twimg\.com|cdn\.bsky\.app|public\.api\.bsky\.app|(?:static1\.)?e621\.net|www\.pixiv\.net|i\.pximg\.net)$/;
const PIXIV_HOSTS = /(?:^|\.)(?:pixiv\.net|pximg\.net)$/;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 3;

type Fetched = { data: ArrayBuffer; type: string; } | { error: string; };

async function read(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
        size += part.value.length;
        if (size > MAX_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(part.value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
    }
    return data;
}

export async function fetchFile(_: IpcMainInvokeEvent, url: string): Promise<Fetched> {
    let target = typeof url === "string" ? URL.parse(url) : null;
    try {
        for (let hop = 0; hop <= MAX_REDIRECTS && target?.protocol === "https:" && ALLOWED_HOSTS.test(target.hostname); hop++) {
            const headers: Record<string, string> = { "User-Agent": "Equicord DownloadAllAttachments" };
            if (PIXIV_HOSTS.test(target.hostname)) headers.Referer = "https://www.pixiv.net/";
            const res = await fetch(target, { redirect: "manual", headers });
            const location = res.headers.get("location");
            if (res.status >= 300 && res.status < 400 && location) {
                target = URL.parse(location, target);
                continue;
            }
            if (!res.ok || !res.body) return { error: `HTTP ${res.status}` };
            const data = await read(res.body);
            if (!data) return { error: "File is too large" };
            return { data: data.buffer as ArrayBuffer, type: res.headers.get("content-type") ?? "" };
        }
        return { error: "Address not allowed" };
    } catch {
        return { error: "Network error" };
    }
}
