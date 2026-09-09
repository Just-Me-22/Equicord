/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ProfilePresetEx } from "./storage";

export interface Field {
    key: string;
    label: string;
    value: string | null;
    bytes: number;
}

/** a data url is base64, so four characters carry three bytes. close enough to tell a
 *  20KB avatar from a 4MB one, which is the question. */
const weigh = (value: unknown) =>
    typeof value === "string" && value.startsWith("data:") ? Math.round(value.length * 0.75) : 0;

export const size = (bytes: number) =>
    bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB`
        : bytes >= 1024 ? `${Math.round(bytes / 1024)}KB`
            : `${bytes}B`;

const shortColour = (value: unknown) =>
    typeof value === "number" ? `#${value.toString(16).padStart(6, "0")}` : null;

export function describe(preset: ProfilePresetEx): Field[] {
    const named = (value: unknown) => {
        const label = (value as { label?: string; })?.label;
        return typeof label === "string" && label ? label : value ? "set" : null;
    };

    return [
        { key: "avatar", label: "Avatar", value: preset.avatarDataUrl ? "an image" : null, bytes: weigh(preset.avatarDataUrl) },
        { key: "banner", label: "Banner", value: preset.bannerDataUrl ? "an image" : null, bytes: weigh(preset.bannerDataUrl) },
        { key: "name", label: "Display name", value: preset.globalName || null, bytes: 0 },
        { key: "bio", label: "Bio", value: preset.bio ? `${preset.bio.slice(0, 40)}${preset.bio.length > 40 ? "..." : ""}` : null, bytes: 0 },
        { key: "pronouns", label: "Pronouns", value: preset.pronouns || null, bytes: 0 },
        { key: "colours", label: "Colours", value: preset.themeColors?.length ? preset.themeColors.map(one => shortColour(one)).join(" ") : shortColour(preset.accentColor), bytes: 0 },
        { key: "decoration", label: "Decoration", value: named(preset.avatarDecoration), bytes: 0 },
        { key: "nameplate", label: "Nameplate", value: named(preset.nameplate), bytes: 0 },
        { key: "effect", label: "Profile effect", value: preset.profileEffect ? preset.profileEffect.title || "set" : null, bytes: 0 },
        { key: "frame", label: "Profile frame", value: preset.profileFrame ? "set" : null, bytes: 0 },
        { key: "nameStyle", label: "Name style", value: preset.displayNameStyles ? "set" : null, bytes: 0 },
        { key: "status", label: "Custom status", value: preset.customStatus?.text || null, bytes: 0 },
        { key: "tag", label: "Server tag", value: preset.primaryGuildId ? "set" : null, bytes: 0 }
    ];
}

export const weight = (preset: ProfilePresetEx) =>
    describe(preset).reduce((sum, field) => sum + field.bytes, 0);

/** the six most common colours in the picture, coarse enough that near identical shades
 *  land in one bucket rather than filling the list with the same colour six times */
export async function palette(dataUrl: string): Promise<number[]> {
    const image = new Image();
    image.src = dataUrl;

    try {
        await image.decode();
    } catch {
        return [];
    }

    const side = 48;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];

    ctx.drawImage(image, 0, 0, side, side);
    const { data } = ctx.getImageData(0, 0, side, side);

    const buckets = new Map<number, { count: number; r: number; g: number; b: number; }>();

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;

        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const key = (r >> 5 << 10) | (g >> 5 << 5) | (b >> 5);
        const seen = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };

        buckets.set(key, { count: seen.count + 1, r: seen.r + r, g: seen.g + g, b: seen.b + b });
    }

    return [...buckets.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
        .map(({ count, r, g, b }) =>
            (Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count));
}
