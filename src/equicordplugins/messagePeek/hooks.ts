/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message, ReactionEmoji } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, MessageStore, useEffect, UserStore, useState } from "@webpack/common";

const MessageActions = findByPropsLazy("fetchMessages", "sendMessage");

const watchers = new Map<string, Set<() => void>>();

const MESSAGE_EVENTS = ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "LOAD_MESSAGES_SUCCESS"] as const;

const REACTION_EVENTS = ["MESSAGE_REACTION_ADD", "MESSAGE_REACTION_REMOVE"] as const;

interface ReactionEvent {
    type: typeof REACTION_EVENTS[number];
    channelId: string;
    messageId: string;
    userId: string;
    emoji?: ReactionEmoji;
}

export interface SeenReaction {
    userId: string | null;
    emoji: ReactionEmoji;
}

const reactions = new Map<string, SeenReaction>();

function onReaction(event: ReactionEvent) {
    if (!event.emoji?.name || !watchers.has(event.channelId)) return;

    if (event.type === "MESSAGE_REACTION_ADD") {
        if (event.userId !== UserStore.getCurrentUser()?.id) reactions.set(event.messageId, { userId: event.userId, emoji: event.emoji });
    } else {
        const seen = reactions.get(event.messageId);
        if (seen?.userId === event.userId && seen.emoji.name === event.emoji.name) reactions.delete(event.messageId);
    }

    onMessageEvent(event);
}

export function reactionOn(message: Message): SeenReaction | null {
    const others = message.reactions?.find(reaction => reaction.count > (reaction.me ? 1 : 0));
    if (!others) return null;
    return reactions.get(message.id) ?? { userId: null, emoji: others.emoji };
}

const PARALLEL = 3;
const asked = new Set<string>();
const waiting: string[] = [];
let running = 0;

function pump() {
    while (running < PARALLEL && waiting.length) {
        const channelId = waiting.shift()!;
        if (!watchers.has(channelId)) {
            asked.delete(channelId);
            continue;
        }

        running++;
        void loadRecent(channelId, 1).then(() => {
            running--;
            pump();
        });
    }
}

export function loadRecent(channelId: string, limit: number) {
    return Promise.resolve(MessageActions.fetchMessages({ channelId, limit })).catch(() => { });
}

function fetchLast(channelId: string) {
    if (asked.has(channelId) || MessageStore.getLastMessage(channelId)) return;

    asked.add(channelId);
    waiting.push(channelId);
    pump();
}

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
        fetchLast(channelId);

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
    for (const event of REACTION_EVENTS) FluxDispatcher.subscribe(event, onReaction);
}

export function stopWatching() {
    for (const event of MESSAGE_EVENTS) FluxDispatcher.unsubscribe(event, onMessageEvent);
    for (const event of REACTION_EVENTS) FluxDispatcher.unsubscribe(event, onReaction);
    watchers.clear();
    reactions.clear();
    waiting.length = 0;
    asked.clear();
    tickers.clear();
    clearInterval(timer);
    timer = undefined;
}
