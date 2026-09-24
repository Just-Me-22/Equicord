/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AttachmentIcon, GifIcon, ImageIcon, Microphone, StickerIcon, VideoIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { pluralize } from "@utils/misc";
import { Message, MessageAttachment } from "@vencord/discord-types";
import { MessageFlags, MessageType } from "@vencord/discord-types/enums";
import { Parser, RelationshipStore, UserStore } from "@webpack/common";

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
    action?: boolean;
    missed?: boolean;
}

const HOUR = 60 * 60 * 1000;
const GIF_ONLY = /^https?:\/\/(\S+\.gif|(tenor|giphy|klipy)\.com\/\S*)$/i;
const LINK_ONLY = /^https?:\/\/([^\s/?#]+)\S*$/i;
const SPOILER = /\|\|[\s\S]+?\|\|/g;
const STICKER_EXT: Partial<Record<number, string>> = { 1: "png", 2: "png", 4: "gif" };

const hideSpoilers = (text: string) => text.replace(SPOILER, "▮▮▮");

function duration(seconds: number) {
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function displayName(userId: string) {
    const user = UserStore.getUser(userId);
    return RelationshipStore.getNickname(userId) || user?.globalName || user?.username || "Someone";
}

function getAttachmentType(contentType = ""): AttachmentType {
    if (contentType === "image/gif") return "gif";
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    return "file";
}

function thumbnail(attachment: MessageAttachment, type: AttachmentType) {
    const url = new URL(attachment.proxy_url);
    url.searchParams.set("width", "32");
    url.searchParams.set("height", "32");
    if (type === "video") url.searchParams.set("format", "webp");

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
    const key = `${message.id}:${message.editedTimestamp ?? ""}:${message.embeds?.length}:${message.call?.endedTimestamp ?? ""}:${settings.store.thumbnails}`;

    const cached = contentCache.get(key);
    if (cached !== undefined) return cached;

    const content = computeMessageContent(message);

    if (contentCache.size >= CONTENT_CACHE_MAX) contentCache.delete(contentCache.keys().next().value!);
    contentCache.set(key, content);

    return content;
}

function systemText(message: Message) {
    const target = message.mentions?.[0];

    switch (message.type) {
        case MessageType.RECIPIENT_ADD: return `added ${target ? displayName(target) : "someone"}`;
        case MessageType.RECIPIENT_REMOVE: return target && target !== message.author.id ? `removed ${displayName(target)}` : "left the group";
        case MessageType.CALL: return "started a call";
        case MessageType.CHANNEL_NAME_CHANGE: return `renamed the group to ${message.content}`;
        case MessageType.CHANNEL_ICON_CHANGE: return "changed the group icon";
        case MessageType.CHANNEL_PINNED_MESSAGE: return "pinned a message";
        default: return null;
    }
}

function isMissedCall(message: Message) {
    const me = UserStore.getCurrentUser()?.id;
    return message.author.id !== me && message.call?.endedTimestamp != null && !message.call.participants.includes(me);
}

function computeMessageContent(message: Message): MessageContent | null {
    if (message.type === MessageType.CALL && isMissedCall(message)) return { text: "Missed call", missed: true };

    const system = systemText(message);
    if (system) return { text: system, action: true };

    if (message.content) {
        const text = message.content.trim();
        if (GIF_ONLY.test(text)) return { text: "sent a GIF", icon: "gif" };

        const link = LINK_ONLY.exec(text);
        if (link) return { text: message.embeds?.[0]?.rawTitle || link[1].replace(/^www\./, "") };

        return { text: Parser.parseInlineReply(hideSpoilers(message.content)) };
    }

    const forwarded = message.messageSnapshots?.[0]?.message;
    if (forwarded) {
        const inner = computeMessageContent(forwarded);
        return inner && { ...inner, text: <>Forwarded: {inner.text}</> };
    }

    if (message.poll) return { text: `Poll: ${message.poll.question.text ?? ""}` };

    if (message.flags & MessageFlags.IS_VOICE_MESSAGE) {
        const seconds = (message.attachments?.[0] as MessageAttachment & { duration_secs?: number; })?.duration_secs;
        return { text: seconds ? `voice message, ${duration(seconds)}` : "voice message", icon: "voice" };
    }

    if (message.attachments?.length) {
        const types = message.attachments.map(a => getAttachmentType(a.content_type));
        const count = types.length;
        const firstType = types[0];

        if (settings.store.thumbnails && (firstType === "image" || firstType === "video")) {
            return { text: <>{thumbnail(message.attachments[0], firstType)}{count > 1 && ` +${count - 1}`}</> };
        }

        const counts = new Map<AttachmentType, number>();
        for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);

        if (counts.size === 1) return { text: pluralize(count, ATTACHMENT_LABELS[firstType]), icon: firstType };
        return { text: [...counts].map(([type, n]) => pluralize(n, ATTACHMENT_LABELS[type])).join(", "), icon: "file" };
    }

    if (message.stickerItems?.length) {
        const sticker = message.stickerItems[0];
        const ext = STICKER_EXT[sticker.format_type];
        if (!ext) return { text: sticker.name, icon: "sticker" };

        return {
            text: <>
                <img
                    className={cl("thumb")}
                    src={`https:${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${sticker.id}.${ext}?size=32`}
                    alt=""
                    loading="lazy"
                />
                {sticker.name}
            </>
        };
    }

    return null;
}

export function plainText(message: Message): string {
    if (message.content) return hideSpoilers(message.content);

    const forwarded = message.messageSnapshots?.[0]?.message;
    if (forwarded) return plainText(forwarded);
    if (message.poll) return message.poll.question.text ?? "";

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
    return minutes < 1 ? "now" : `${minutes}m`;
}

export function formatTimestamp(timestamp: number) {
    switch (settings.store.timestampStyle) {
        case "clock": {
            const sent = new Date(timestamp);
            return sent.toDateString() === new Date().toDateString()
                ? sent.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : sent.toLocaleDateString([], { day: "numeric", month: "short" });
        }
        case "date": return new Date(timestamp).toLocaleDateString([], { day: "numeric", month: "short" });
        default: return formatRelativeTime(timestamp);
    }
}
