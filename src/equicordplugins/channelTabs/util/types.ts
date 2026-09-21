/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type BasicChannelTabsProps = {
    guildId: string;
    channelId: string;
};
export interface ChannelTabsProps extends BasicChannelTabsProps {
    compact: boolean;
    messageId?: string;
    pinned?: boolean;
    id: number;
    groupId?: string;
    escapedGroup?: boolean;
}
export interface TabGroup {
    id: string;
    name?: string;
    guildId?: string;
    collapsed: boolean;
    auto: boolean;
}
export type TabSegment = ChannelTabsProps | { group: TabGroup; tabs: ChannelTabsProps[]; };
export interface PersistedTabs {
    [userId: string]: {
        openTabs: ChannelTabsProps[],
        openTabIndex: number;
        tabGroups?: TabGroup[];
    };
}

export interface Bookmark {
    channelId: string;
    guildId: string;
    name: string;
}
export interface BookmarkFolder {
    bookmarks: Bookmark[];
    name: string;
    iconColor: string;
    iconName?: string;
}
export interface BookmarkProps {
    bookmarks: Bookmarks,
    index: number,
    methods: UseBookmarkMethods;
}
export type Bookmarks = (Bookmark | BookmarkFolder)[];
export type UseBookmarkMethods = {
    addBookmark: (bookmark: Omit<Bookmark, "name"> & { name?: string; }, folderIndex?: number) => void;
    addFolder: (name?: string, iconColor?: string, iconName?: string) => number;
    deleteBookmark: (index: number, folderIndex?: number) => void;
    editBookmark: (index: number, bookmark: Partial<Bookmark | BookmarkFolder>, modalKey?) => void;
    moveDraggedBookmarks: (index1: number, index2: number) => void;
};
export type UseBookmark = [Bookmarks | undefined, UseBookmarkMethods];
