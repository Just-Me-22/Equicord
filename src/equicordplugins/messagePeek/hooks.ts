/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { FluxDispatcher, MessageStore, useEffect, useState } from "@webpack/common";

const watchers = new Map<string, Set<() => void>>();

const MESSAGE_EVENTS = ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "LOAD_MESSAGES_SUCCESS"] as const;

function onMessageEvent(event: any) {
    const channelId = event.channelId ?? event.message?.channel_id;
    if (channelId == null) return;

    const listeners = watchers.get(channelId);
    if (listeners) for (const notify of listeners) notify();
}

export function useLastMessage(channelId: string) {
    const [message, setMessage] = useState(() => MessageStore.getLastMessage(channelId) as Message | undefined);

    useEffect(() => {
        const update = () => setMessage(MessageStore.getLastMessage(channelId) as Message | undefined);
        update();

        let listeners = watchers.get(channelId);
        if (!listeners) watchers.set(channelId, listeners = new Set());
        listeners.add(update);

        return () => {
            listeners!.delete(update);
            if (listeners!.size === 0) watchers.delete(channelId);
        };
    }, [channelId]);

    return message;
}

const tickers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

export function useMinute(active: boolean) {
    const [, bump] = useState(0);

    useEffect(() => {
        if (!active) return;

        const notify = () => bump(n => n + 1);
        tickers.add(notify);
        timer ??= setInterval(() => tickers.forEach(tick => tick()), 60_000);

        return () => {
            tickers.delete(notify);
            if (tickers.size || !timer) return;
            clearInterval(timer);
            timer = undefined;
        };
    }, [active]);
}

export function startWatching() {
    for (const event of MESSAGE_EVENTS) FluxDispatcher.subscribe(event, onMessageEvent);
}

export function stopWatching() {
    for (const event of MESSAGE_EVENTS) FluxDispatcher.unsubscribe(event, onMessageEvent);
    watchers.clear();
    tickers.clear();
    clearInterval(timer);
    timer = undefined;
}
