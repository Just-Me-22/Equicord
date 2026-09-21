/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildStore, ReadStateStore } from "@webpack/common";

import { settings } from "./constants";
import { closeTab, openedTabs, openTabHistory, triggerTabsUpdate } from "./tabs";
import { ChannelTabsProps, TabGroup, TabSegment } from "./types";

export const tabGroups: TabGroup[] = [];

let highestGroupIdIndex = 0;
const genGroupId = () => `g${highestGroupIdIndex++}`;

export const getGroup = (groupId: string) => tabGroups.find(g => g.id === groupId);

export const getGroupMembers = (groupId: string) => openedTabs.filter(t => t.groupId === groupId);

export function groupLabel(group: TabGroup) {
    if (group.name) return group.name;
    if (group.guildId) return GuildStore.getGuild(group.guildId)?.name ?? "Group";
    return "Group";
}

export function getGroupSegments(): TabSegment[] {
    const segments: TabSegment[] = [];
    let run: { group: TabGroup; tabs: ChannelTabsProps[]; } | undefined;

    for (const tab of openedTabs) {
        if (!tab) continue;

        if (tab.groupId && run?.group.id === tab.groupId) {
            run.tabs.push(tab);
            continue;
        }

        const group = tab.groupId ? getGroup(tab.groupId) : undefined;
        if (!group) {
            run = undefined;
            segments.push(tab);
            continue;
        }

        run = { group, tabs: [tab] };
        segments.push(run);
    }

    return segments;
}

/** a mention in the stack is the thing you opened it for, so it wins over the tab you
 *  happened to be on last */
export function getGroupActiveTab(groupId: string) {
    const members = getGroupMembers(groupId);

    const mentioned = members.find(t => ReadStateStore.getMentionCount(t.channelId) > 0);
    if (mentioned) return mentioned;

    const unread = members.find(t => ReadStateStore.hasUnread(t.channelId));
    if (unread) return unread;

    for (let i = openTabHistory.length - 1; i >= 0; i--) {
        const tab = members.find(t => t.id === openTabHistory[i]);
        if (tab) return tab;
    }
    return members[0];
}

function insertAfter(tab: ChannelTabsProps, anchor: ChannelTabsProps) {
    openedTabs.splice(openedTabs.indexOf(tab), 1);
    openedTabs.splice(openedTabs.indexOf(anchor) + 1, 0, tab);
}

function appendToRun(tab: ChannelTabsProps, groupId: string) {
    const members = getGroupMembers(groupId).filter(t => t !== tab);
    insertAfter(tab, members[members.length - 1]);
}

export function pruneGroups() {
    for (let i = tabGroups.length - 1; i >= 0; i--) {
        const members = getGroupMembers(tabGroups[i].id);
        if (members.length >= 2) continue;

        for (const tab of members) delete tab.groupId;
        tabGroups.splice(i, 1);
    }
}

export function groupTabs(draggedId: number, targetId: number) {
    const dragged = openedTabs.find(t => t.id === draggedId);
    const target = openedTabs.find(t => t.id === targetId);
    if (!dragged || !target || dragged === target) return;

    let group = target.groupId ? getGroup(target.groupId) : undefined;
    if (!group) {
        const sharedGuild = dragged.guildId && dragged.guildId !== "@me" && dragged.guildId === target.guildId;
        group = {
            id: genGroupId(),
            guildId: sharedGuild ? dragged.guildId : undefined,
            collapsed: false,
            auto: false
        };
        tabGroups.push(group);
        target.groupId = group.id;
    }

    dragged.groupId = group.id;
    delete dragged.escapedGroup;
    appendToRun(dragged, group.id);

    pruneGroups();
    triggerTabsUpdate();
}

export function moveDraggedGroup(groupId: string, targetIndex: number) {
    const members = getGroupMembers(groupId);
    if (!members.length) return;

    const start = openedTabs.indexOf(members[0]);
    const hovered = openedTabs[targetIndex];
    if (hovered.groupId && hovered.groupId !== groupId) {
        const other = getGroupMembers(hovered.groupId);
        targetIndex = openedTabs.indexOf(targetIndex > start ? other[other.length - 1] : other[0]);
    }
    if (targetIndex === start) return;

    openedTabs.splice(start, members.length);
    openedTabs.splice(targetIndex > start ? targetIndex - members.length + 1 : targetIndex, 0, ...members);
    triggerTabsUpdate();
}

export function removeFromGroup(tabId: number, manual: boolean) {
    const tab = openedTabs.find(t => t.id === tabId);
    if (!tab?.groupId) return;

    const group = getGroup(tab.groupId);
    const members = getGroupMembers(tab.groupId).filter(t => t !== tab);
    delete tab.groupId;
    if (manual && group?.auto) tab.escapedGroup = true;
    if (members.length) insertAfter(tab, members[members.length - 1]);

    pruneGroups();
    triggerTabsUpdate();
}

function detachGroup(groupId: string) {
    for (const tab of getGroupMembers(groupId)) delete tab.groupId;

    const i = tabGroups.findIndex(g => g.id === groupId);
    if (i !== -1) tabGroups.splice(i, 1);
}

export function ungroup(groupId: string) {
    detachGroup(groupId);
    triggerTabsUpdate();
}

export function closeGroup(groupId: string) {
    for (const id of getGroupMembers(groupId).map(t => t.id)) closeTab(id);
}

export function toggleGroupCollapsed(groupId: string) {
    const group = getGroup(groupId);
    if (!group) return;

    group.collapsed = !group.collapsed;
    triggerTabsUpdate();
}

export function renameGroup(groupId: string, name: string) {
    const group = getGroup(groupId);
    if (!group) return;

    if (name) group.name = name;
    else delete group.name;
    triggerTabsUpdate();
}

export function normalizeContiguity(tabId: number) {
    const tab = openedTabs.find(t => t.id === tabId);
    if (!tab) return;

    const i = openedTabs.indexOf(tab);
    const prev = openedTabs[i - 1];
    const next = openedTabs[i + 1];

    if (tab.groupId) {
        if (prev?.groupId !== tab.groupId && next?.groupId !== tab.groupId) {
            const group = getGroup(tab.groupId);
            delete tab.groupId;
            if (group?.auto) tab.escapedGroup = true;
        }
    } else if (prev?.groupId && prev.groupId === next?.groupId) {
        appendToRun(tab, prev.groupId);
    }

    pruneGroups();
}

export function autoGroupTab(tab: ChannelTabsProps) {
    if (!settings.store.autoGroupSameServer) return;
    if (!tab.guildId || tab.guildId === "@me" || tab.groupId || tab.escapedGroup) return;

    const existing = tabGroups.find(g => g.auto && g.guildId === tab.guildId);
    if (existing) {
        tab.groupId = existing.id;
        appendToRun(tab, existing.id);
        return;
    }

    const partner = openedTabs.find(t => t !== tab && t.guildId === tab.guildId && !t.groupId && !t.escapedGroup);
    if (!partner) return;

    const group: TabGroup = { id: genGroupId(), guildId: tab.guildId, collapsed: false, auto: true };
    tabGroups.push(group);
    partner.groupId = group.id;
    tab.groupId = group.id;
    insertAfter(tab, partner);
}

export function autoGroupAll() {
    for (const tab of [...openedTabs]) autoGroupTab(tab);
}

export function ungroupAutoGroups() {
    for (const group of [...tabGroups]) if (group.auto) detachGroup(group.id);
}

export function resetGroups(saved?: TabGroup[]) {
    tabGroups.length = 0;
    highestGroupIdIndex = 0;
    if (!saved) return;

    tabGroups.push(...saved.map(group => ({ ...group })));
    for (const group of tabGroups) {
        const index = parseInt(group.id.slice(1), 10);
        if (index >= highestGroupIdIndex) highestGroupIdIndex = index + 1;
    }
}
