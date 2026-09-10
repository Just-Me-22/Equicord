/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** the strongest colour in a cover, bucketed coarsely so near identical shades land
 *  together. greys are skipped: nearly every sleeve has some and none of them read as
 *  the colour of the record. averaging the whole thing gives mud on a busy sleeve,
 *  which is the reason this counts buckets rather than taking a mean. */
export async function coverColour(url: string): Promise<string | null> {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;

    try {
        await image.decode();
    } catch {
        return null;
    }

    const side = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    // nearest neighbour, so every sample is a pixel off the sleeve. smoothing averages
    // each block first, which blends neighbouring colours into shades that are on no
    // part of the cover, and those blends then win the count
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, side, side);

    let data: Uint8ClampedArray;
    try {
        // a sleeve the cdn declines to share cross origin reads back as a tainted canvas
        ({ data } = ctx.getImageData(0, 0, side, side));
    } catch {
        return null;
    }

    const buckets = new Map<number, { n: number; r: number; g: number; b: number; }>();

    for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (data[i + 3] < 128) continue;

        const top = Math.max(r, g, b);
        // a dark sleeve is still a coloured one. a floor of 40 threw away the whole navy
        // field of a night sky cover and left only the small bright glow at its centre,
        // which is how a blue record came out rose
        if (top < 12 || top - Math.min(r, g, b) < 18) continue;

        const key = (r >> 4 << 8) | (g >> 4 << 4) | (b >> 4);
        const seen = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, { n: seen.n + 1, r: seen.r + r, g: seen.g + g, b: seen.b + b });
    }

    const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    if (!best) return null;

    const rgb = [best.r, best.g, best.b].map(sum => Math.round(sum / best.n));
    // the panel is dark and plenty of sleeves are near black, so a dim winner is lifted
    // until it reads rather than being shown as found
    const lift = Math.max(1, 150 / Math.max(...rgb));

    return `rgb(${rgb.map(one => Math.min(255, Math.round(one * lift))).join(", ")})`;
}
