/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";
import { Embed, EmbedMedia, Message } from "@vencord/discord-types";
import { StickerFormatType } from "@vencord/discord-types/enums";

import { videoToGif } from "./gif";

type Load = () => Promise<Blob>;
export type Item = { name: string; load: Load; };

const Native = VencordNative?.pluginHelpers?.DownloadAllAttachments as PluginNative<typeof import("./native")> | undefined;

const RENDERER_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const TENOR = /^https:\/\/media\.tenor\.com\/([\w-]+)[\w-]{5}\/([^/?#]+)\.\w+/;
const GIPHY = /^https:\/\/(?:media\d?|i)\.giphy\.com\/media\/(?:v1\.[^/]+\/)?([\w-]+)\//;
const TWITTER_MEDIA = /^https:\/\/pbs\.twimg\.com\/media\/([\w-]+)(?:\.(\w+))?(?:\?.*?format=(\w+))?/;
const TWEET = /^https:\/\/(?:www\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com\/\w+\/status\/\d+/;
const BLUESKY_POST = /^https:\/\/(?:bsky\.app|[fv]xbsky\.app|bskx\.app)\/profile\/([^/]+)\/post\/(\w+)/;
const BLUESKY_IMAGE = /^https:\/\/cdn\.bsky\.app\/img\/feed_(?:thumbnail|fullsize)\//;
const E621_POST = /^https:\/\/e(?:621|926)\.net\/posts\/(\d+)/;
const PIXIV_WORK = /^https:\/\/(?:www\.)?(?:pixiv|phixiv)\.net\/(?:\w{2}\/)?artworks\/(\d+)/;
const EMOJI = /<(a?):(\w+):(\d+)>/;
const STICKER_EXTENSIONS: Partial<Record<StickerFormatType, string>> = { [StickerFormatType.PNG]: "png", [StickerFormatType.APNG]: "png", [StickerFormatType.GIF]: "gif" };

export async function fetchBlob(url: string): Promise<Blob> {
    if (Native && !RENDERER_HOSTS.has(new URL(url).hostname)) {
        const result = await Native.fetchFile(url);
        if ("error" in result) throw new Error(result.error);
        return new Blob([result.data], { type: result.type });
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
}

async function firstWorking(loads: Load[]): Promise<Blob> {
    let failure: unknown = new Error("Nothing to download");
    for (const load of loads) {
        try {
            return await load();
        } catch (error) {
            failure = error;
        }
    }
    throw failure;
}

const fromUrls = (urls: (string | undefined)[]): Load[] => [...new Set(urls.filter(Boolean) as string[])].map(url => () => fetchBlob(url));
const converted = (url?: string): Load[] => url ? [async () => videoToGif(await fetchBlob(url))] : [];
const fetchJson = async <T>(url: string): Promise<T> => JSON.parse(await (await fetchBlob(url)).text());

function nameOf(url: string) {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "file";
    return decodeURIComponent(last).replace(/@\w+$/, "");
}

function fullSize(url: string) {
    const tweet = TWITTER_MEDIA.exec(url);
    if (tweet) return `https://pbs.twimg.com/media/${tweet[1]}?format=${tweet[3] ?? tweet[2] ?? "jpg"}&name=orig`;
    if (BLUESKY_IMAGE.test(url)) return url.replace("/feed_thumbnail/", "/feed_fullsize/");
    return url;
}

const mediaFile = (media: EmbedMedia): Item => ({ name: nameOf(media.url), load: () => firstWorking(fromUrls([fullSize(media.url), media.url, media.proxyURL])) });

function gifUrl(url?: string) {
    const tenor = url && TENOR.exec(url);
    if (tenor) return `https://media.tenor.com/${tenor[1]}AAAAC/${tenor[2]}.gif`;
    const giphy = url && GIPHY.exec(url);
    if (giphy) return `https://media.giphy.com/media/${giphy[1]}/giphy.gif`;
    return url && new URL(url).pathname.endsWith(".gif") ? url : undefined;
}

function gifItem(embed: Embed): Item {
    const name = nameOf(embed.url).replace(/\.gif$/, "");
    const direct = gifUrl(embed.video?.url) ?? gifUrl(embed.thumbnail?.url) ?? gifUrl(embed.url);
    return { name: `${name}.gif`, load: () => firstWorking([...fromUrls([direct]), ...converted(embed.video?.proxyURL), ...converted(embed.video?.url)]) };
}

async function postFiles(url: string): Promise<string[]> {
    const bluesky = BLUESKY_POST.exec(url);
    if (bluesky) {
        type Images = { images?: { fullsize: string; }[]; media?: { images?: { fullsize: string; }[]; }; };
        const uri = `at://${bluesky[1]}/app.bsky.feed.post/${bluesky[2]}`;
        const { thread } = await fetchJson<{ thread: { post: { embed?: Images; }; }; }>(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&parentHeight=0&uri=${encodeURIComponent(uri)}`);
        return (thread.post.embed?.images ?? thread.post.embed?.media?.images ?? []).map(image => image.fullsize);
    }
    const e621 = E621_POST.exec(url);
    if (e621) {
        const { post } = await fetchJson<{ post: { file: { url: string | null; }; }; }>(`https://e621.net/posts/${e621[1]}.json`);
        return post.file.url ? [post.file.url] : [];
    }
    const pixiv = PIXIV_WORK.exec(url);
    if (pixiv) {
        const { body } = await fetchJson<{ body: { urls: { original: string; }; }[]; }>(`https://www.pixiv.net/ajax/illust/${pixiv[1]}/pages`);
        return body.map(page => page.urls.original);
    }
    return [];
}

const isPost = (url?: string) => !!url && [TWEET, BLUESKY_POST, E621_POST, PIXIV_WORK].some(pattern => pattern.test(url));

export function isMediaEmbed(embed: Embed) {
    switch (embed.type) {
        case "gifv": return true;
        case "image": return !!(embed.image ?? embed.thumbnail);
        case "video": return !!embed.video?.proxyURL;
        default: return isPost(embed.url);
    }
}

async function embedItems(embed: Embed): Promise<Item[]> {
    if (embed.type === "gifv") return [gifItem(embed)];
    if (embed.type === "image") return [mediaFile((embed.image ?? embed.thumbnail)!)];
    if (embed.type === "video") return [mediaFile(embed.video!)];
    const shown = [embed.image, ...embed.images ?? [], embed.video].filter(Boolean) as EmbedMedia[];
    if (TWEET.test(embed.url)) return shown.map(mediaFile);
    const files = await postFiles(embed.url).catch(() => []);
    if (files.length) return files.map(url => ({ name: nameOf(url), load: () => fetchBlob(url) }));
    const preview = shown[0] ?? embed.thumbnail;
    return preview && !preview.url.includes("/avatar/") ? [mediaFile(preview)] : [];
}

function stickerItems(message: Message): Item[] {
    return message.stickerItems.flatMap(sticker => {
        const extension = STICKER_EXTENSIONS[sticker.format_type];
        if (!extension) return [];
        const url = `https:${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${sticker.id}.${extension}?size=512`;
        return [{ name: `${sticker.name}.${extension}`, load: () => fetchBlob(url) }];
    });
}

function emojiItems(message: Message): Item[] {
    const seen = new Set<string>();
    return [...message.content.matchAll(new RegExp(EMOJI, "g"))].flatMap(([, animated, name, id]) => {
        if (seen.has(id)) return [];
        seen.add(id);
        const extension = animated ? "gif" : "png";
        const url = `https:${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/emojis/${id}.${extension}`;
        return [{ name: `${name}.${extension}`, load: () => fetchBlob(url) }];
    });
}

const withForwards = (message: Message) => [message, ...message.messageSnapshots.map(snapshot => snapshot.message)];

export const hasMedia = (message: Message) => withForwards(message).some(each =>
    each.attachments.length || each.stickerItems.some(sticker => STICKER_EXTENSIONS[sticker.format_type]) || EMOJI.test(each.content) || each.embeds.some(isMediaEmbed));

export async function itemsOf(message: Message, allFileTypes: boolean): Promise<Item[]> {
    const items: Item[] = [];
    const posts = new Set<string>();
    for (const each of withForwards(message)) {
        for (const attachment of each.attachments)
            items.push({ name: attachment.filename, load: () => firstWorking(fromUrls([attachment.proxy_url, allFileTypes ? attachment.url : undefined])) });
        items.push(...stickerItems(each), ...emojiItems(each));
        for (const embed of each.embeds.filter(isMediaEmbed)) {
            if (!["gifv", "image", "video"].includes(embed.type) && !TWEET.test(embed.url)) {
                if (posts.has(embed.url)) continue;
                posts.add(embed.url);
            }
            items.push(...await embedItems(embed));
        }
    }
    return items;
}
