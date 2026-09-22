/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    hideMuted: {
        type: OptionType.BOOLEAN,
        description: "Hide message previews and timestamps for muted DMs and group chats.",
        default: false
    },
    hideInStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Hide message previews while Streamer Mode hides personal information.",
        default: false
    },
    blurPreviews: {
        type: OptionType.BOOLEAN,
        description: "Blur message previews until you hover them.",
        default: false
    },
    activityRule: {
        type: OptionType.SELECT,
        description: "When a conversation shows the person's activity instead of the last message.",
        options: [
            { label: "After an hour without messages", value: "switch", default: true },
            { label: "Never", value: "message" },
            { label: "Whenever they have one", value: "activity" }
        ]
    },
    previewLines: {
        type: OptionType.SELECT,
        description: "How many lines a preview may use.",
        options: [
            { label: "One", value: "1", default: true },
            { label: "Two", value: "2" }
        ]
    },
    timestampStyle: {
        type: OptionType.SELECT,
        description: "How the timestamp reads.",
        options: [
            { label: "How long ago", value: "relative", default: true },
            { label: "The time it was sent", value: "clock" },
            { label: "The date it was sent", value: "date" }
        ]
    },
    drafts: {
        type: OptionType.BOOLEAN,
        description: "Show unsent drafts in place of the last message.",
        default: false
    },
    typingIndicator: {
        type: OptionType.BOOLEAN,
        description: "Show who is typing in place of the last message.",
        default: false
    },
    callIndicator: {
        type: OptionType.BOOLEAN,
        description: "Show an ongoing call and how long it has been going.",
        default: false
    },
    thumbnails: {
        type: OptionType.BOOLEAN,
        description: "Show a thumbnail instead of the words \"1 image\".",
        default: false
    },
    senderAvatars: {
        type: OptionType.BOOLEAN,
        description: "Show the sender's avatar before their name.",
        default: false
    },
    boldUnread: {
        type: OptionType.BOOLEAN,
        description: "Bold the preview of unread conversations.",
        default: false
    },
    unreadCount: {
        type: OptionType.BOOLEAN,
        description: "Show how many messages are unread.",
        default: false
    },
    keywords: {
        type: OptionType.STRING,
        description: "Highlight previews containing any of these words, separated by commas.",
        default: ""
    },
    staleAfter: {
        type: OptionType.NUMBER,
        description: "Fade previews older than this many hours. 0 leaves them alone.",
        default: 0
    },
    fullTextTooltip: {
        type: OptionType.BOOLEAN,
        description: "Hovering a preview shows the whole message.",
        default: false
    },
    jumpToMessage: {
        type: OptionType.BOOLEAN,
        description: "Clicking the preview opens the conversation at that message.",
        default: false
    },
    quickReply: {
        type: OptionType.BOOLEAN,
        description: "Hovering a conversation offers a reply box.",
        default: false
    },
    quickReact: {
        type: OptionType.BOOLEAN,
        description: "Hovering a conversation offers a reaction to its last message.",
        default: false
    },
    markReadButton: {
        type: OptionType.BOOLEAN,
        description: "Hovering an unread conversation offers a mark-as-read button.",
        default: false
    },
    searchBox: {
        type: OptionType.BOOLEAN,
        description: "Add a box above the DM list that searches names and last messages.",
        default: false
    }
});
