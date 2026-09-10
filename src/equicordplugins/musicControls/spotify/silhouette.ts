/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** a signature for the track, not a reading of it: spotify plays in its own process and
 *  discord never touches the audio. the shape comes out of the track's name, so a song
 *  looks the same every time you play it and no two songs look alike. */
export function silhouette(text: string, count: number): number[] {
    let seed = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 0x01000193) >>> 0;
    }

    const heights: number[] = [];
    for (let i = 0; i < count; i++) {
        seed = (Math.imul(seed ^ (seed >>> 15), 0x2545f491) + 0x9e3779b9) >>> 0;
        // a gentle arc under the noise, so it swells and fades rather than looking like static
        const arc = Math.sin((i / count) * Math.PI) * 0.55 + 0.3;
        heights.push(Math.round((0.25 + (seed % 1000) / 1000 * 0.75) * arc * 100));
    }

    return heights;
}
