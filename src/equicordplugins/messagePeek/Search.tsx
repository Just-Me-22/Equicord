/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { ChannelStore, MessageStore, ReadStateStore, ReadStateUtils, RelationshipStore, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

import { READ_ICON } from "./Actions";
import { plainText } from "./content";
import { settings } from "./settings";

const cl = classNameFactory("vc-message-peek-");

let query = "";
const listeners = new Set<() => void>();

function setQuery(next: string) {
    query = next;
    listeners.forEach(notify => notify());
}

function useQuery() {
    const [, bump] = useState(0);

    useEffect(() => {
        const notify = () => bump(n => n + 1);
        listeners.add(notify);
        return () => void listeners.delete(notify);
    }, []);

    return query;
}

function nameOf(id: string) {
    const user = UserStore.getUser(id);
    return [RelationshipStore.getNickname(id), user?.globalName, user?.username];
}

function matches(channelId: string, needle: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;

    const names = [channel.name, ...channel.recipients.flatMap(nameOf)];
    if (names.some(name => name?.toLowerCase().includes(needle))) return true;

    const message = MessageStore.getLastMessage(channelId);
    return Boolean(message && plainText(message).toLowerCase().includes(needle));
}

export function useFilteredIds(ids: string[]) {
    const { searchBox } = settings.use(["searchBox"]);
    const needle = useQuery().trim().toLowerCase();

    if (!searchBox || !needle) return ids;
    return ids.filter(id => matches(id, needle));
}

function SearchRow() {
    const [value, setValue] = useState(query);

    const update = (next: string) => {
        setValue(next);
        setQuery(next);
    };

    const unread = useStateFromStores(
        [ReadStateStore],
        () => ChannelStore.getSortedPrivateChannels().filter(channel => ReadStateStore.hasUnread(channel.id)).map(channel => channel.id).join(),
        []
    );

    return <li className={cl("search")}>
        <input
            className={cl("search-input")}
            value={value}
            placeholder="Search messages"
            onChange={e => update(e.currentTarget.value)}
            onKeyDown={e => {
                if (e.key === "Escape") update("");
            }}
        />
        {unread && <button
            className={cl("action")}
            aria-label="Mark all DMs as read"
            onClick={() => {
                for (const id of unread.split(",")) ReadStateUtils.ackChannel(ChannelStore.getChannel(id));
            }}
        >
            <svg width={14} height={14} viewBox="0 0 24 24"><path fill="currentColor" d={READ_ICON} /></svg>
        </button>}
    </li>;
}

export function withSearch(children: React.ReactNode[] | null | undefined) {
    if (!settings.store.searchBox) return children;
    return [...(children ?? []), <SearchRow key="vc-message-peek-search" />];
}

export function clearSearch() {
    setQuery("");
}
