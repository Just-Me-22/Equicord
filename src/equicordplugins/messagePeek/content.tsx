/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AttachmentIcon, GifIcon, ImageIcon, Microphone, StickerIcon, VideoIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { pluralize } from "@utils/misc";
import { Message, MessageAttachment } from "@vencord/discord-types";
import { MessageFlags } from "@vencord/discord-types/enums";
import { Parser } from "@webpack/common";

import { settings } from "./settings";

const cl = classNameFactory("vc-message-peek-");

type AttachmentType = "image" | "gif" | "video" | "file";
type IconType = AttachmentType | "voice" | "sticker";

export const Icons: Record<IconType, React.ComponentType<{ size: string; className: string; }>> = {
    image: ImageIcon,
    file: AttachmentIcon,
    voice: Microphone,
    sticker: StickerIcon,
    gif: GifIcon,
    video: VideoIcon,
};

const ATTACHMENT_LABELS: Record<AttachmentType, string> = {
    gif: "GIF",
    image: "image",
    video: "video",
    file: "file"
};

export interface MessageContent {
    text: React.ReactNode;
    icon?: IconType;
}

const HOUR = 60 * 60 * 1000;

function getAttachmentType(contentType = ""): AttachmentType {
    if (contentType === "image/gif") return "gif";
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    return "file";
}

function thumbnail(attachment: MessageAttachment) {
    const url = new URL(attachment.proxy_url);
    url.searchParams.set("width", "32");
    url.searchParams.set("height", "32");

    return <img
        className={cl("thumb", { "thumb-spoiler": attachment.spoiler })}
        src={url.href}
        alt={attachment.filename}
        loading="lazy"
    />;
}

const CONTENT_CACHE_MAX = 300;
const contentCache = new Map<string, MessageContent | null>();

export function getMessageContent(message: Message): MessageContent | null {
    const key = `${message.id}:${message.editedTimestamp ?? ""}:${settings.store.thumbnails}`;

    const cached = contentCache.get(key);
    if (cached !== undefined) return cached;

    const content = computeMessageContent(message);

    if (contentCache.size >= CONTENT_CACHE_MAX) contentCache.delete(contentCache.keys().next().value!);
    contentCache.set(key, content);

    return content;
}

function computeMessageContent(message: Message): MessageContent | null {
    if (message.content) {
        if (/https?:\/\/(\S+\.gif|tenor\.com|giphy\.com|klipy\.com)/i.test(message.content)) {
            return { text: "sent a GIF", icon: "gif" };
        }
        return { text: Parser.parseInlineReply(message.content) };
    }

    if (message.flags & MessageFlags.IS_VOICE_MESSAGE) {
        return { text: "voice message", icon: "voice" };
    }

    if (message.attachments?.length) {
        const types = message.attachments.map(a => getAttachmentType(a.content_type));
        const count = types.length;
        const firstType = types[0];

        if (settings.store.thumbnails && firstType === "image") {
            return { text: <>{thumbnail(message.attachments[0])}{count > 1 && ` +${count - 1}`}</> };
        }

        if (types.every(t => t === firstType)) {
            return { text: pluralize(count, ATTACHMENT_LABELS[firstType]), icon: firstType };
        }
        return { text: pluralize(count, "file"), icon: "file" };
    }

    if (message.stickerItems?.length) {
        return { text: message.stickerItems[0].name, icon: "sticker" };
    }

    return null;
}

export function plainText(message: Message) {
    if (message.content) return message.content;
    if (message.attachments?.length) return message.attachments.map(a => a.filename).join(", ");
    return message.stickerItems?.[0]?.name ?? "";
}

let keywordSource = "";
let keywordPatterns: RegExp[] = [];

export function matchesKeyword(text: string) {
    const { keywords } = settings.store;
    if (!keywords) return false;

    if (keywords !== keywordSource) {
        keywordSource = keywords;
        keywordPatterns = keywords.split(",")
            .map(term => term.trim())
            .filter(Boolean)
            .map(term => new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu"));
    }

    return keywordPatterns.some(pattern => pattern.test(text));
}

export function isStale(timestamp: number) {
    const { staleAfter } = settings.store;
    return staleAfter > 0 && Date.now() - timestamp > staleAfter * HOUR;
}

export function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days >= 365) return `${Math.floor(days / 365)}y`;
    if (days >= 30) return `${Math.floor(days / 30)}mo`;
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    return `${Math.max(1, minutes)}m`;
}

export function formatTimestamp(timestamp: number) {
    switch (settings.store.timestampStyle) {
        case "clock": return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        case "date": return new Date(timestamp).toLocaleDateString([], { day: "numeric", month: "short" });
        default: return formatRelativeTime(timestamp);
    }
}
