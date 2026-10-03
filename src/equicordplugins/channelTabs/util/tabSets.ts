/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserStore } from "@webpack/common";

import { settings } from "./constants";
import { currentTabsSnapshot, replaceTabsWith } from "./tabs";
import { TabsSnapshot } from "./types";

type TabSets = Record<string, Record<string, TabsSnapshot>>;

const currentUserId = () => UserStore.getCurrentUser()?.id;

export function tabSetNames(): string[] {
    const userId = currentUserId();
    return userId ? Object.keys(settings.store.tabSets[userId] ?? {}) : [];
}

function writeTabSets(change: (mine: Record<string, TabsSnapshot>) => void) {
    const userId = currentUserId();
    if (!userId) return;

    const all: TabSets = JSON.parse(JSON.stringify(settings.store.tabSets));
    const mine = all[userId] ?? {};
    change(mine);
    all[userId] = mine;
    settings.store.tabSets = all;
}

export const saveTabSet = (name: string) => writeTabSets(mine => { mine[name] = currentTabsSnapshot(); });

export const deleteTabSet = (name: string) => writeTabSets(mine => { delete mine[name]; });

export function openTabSet(name: string) {
    const userId = currentUserId();
    const saved = userId ? settings.store.tabSets[userId]?.[name] : undefined;
    if (saved) replaceTabsWith(JSON.parse(JSON.stringify(saved)));
}
