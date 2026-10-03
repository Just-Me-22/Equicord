/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { applyPalette, GIFEncoder, quantize } from "gifenc";

const FPS = 25;
const MAX_FRAMES = 200;
const MAX_SIDE = 640;
const PALETTE_FRAMES = 8;

function loaded(src: string) {
    return new Promise<HTMLVideoElement>((resolve, reject) => {
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.addEventListener("loadeddata", () => resolve(video), { once: true });
        video.addEventListener("error", () => reject(new Error("Could not read the GIF's video")), { once: true });
        video.src = src;
    });
}

function seek(video: HTMLVideoElement, time: number) {
    return new Promise<void>(resolve => {
        video.currentTime = time;
        if (!video.seeking) resolve();
        else video.addEventListener("seeked", () => resolve(), { once: true });
    });
}

function same(a: Uint8ClampedArray, b: Uint8ClampedArray) {
    const left = new Uint32Array(a.buffer);
    const right = new Uint32Array(b.buffer);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
}

export async function videoToGif(video: Blob): Promise<Blob> {
    const src = URL.createObjectURL(video);
    try {
        const element = await loaded(src);
        const scale = Math.min(1, MAX_SIDE / Math.max(element.videoWidth, element.videoHeight));
        const width = Math.round(element.videoWidth * scale);
        const height = Math.round(element.videoHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

        const frames = Math.max(1, Math.min(Math.floor(element.duration * FPS), MAX_FRAMES));
        const step = element.duration / frames;
        const frameAt = async (index: number) => {
            await seek(element, index * step);
            ctx.drawImage(element, 0, 0, width, height);
            return ctx.getImageData(0, 0, width, height).data;
        };

        const samples = new Uint8ClampedArray(width * height * 4 * Math.min(PALETTE_FRAMES, frames));
        for (let i = 0; i < Math.min(PALETTE_FRAMES, frames); i++)
            samples.set(await frameAt(Math.floor(i * frames / PALETTE_FRAMES)), i * width * height * 4);
        const palette = quantize(samples, 256);

        const gif = GIFEncoder();
        const delay = Math.round(step * 1000);
        let held: { index: Uint8Array; delay: number; } | null = null;
        let previous: Uint8ClampedArray | null = null;
        const write = ({ index, delay }: { index: Uint8Array; delay: number; }, first: boolean) =>
            gif.writeFrame(index, width, height, { delay, palette: first ? palette : undefined });

        let written = 0;
        for (let i = 0; i < frames; i++) {
            const data = await frameAt(i);
            if (held && previous && same(data, previous)) {
                held.delay += delay;
                continue;
            }
            if (held) write(held, written++ === 0);
            held = { index: applyPalette(data, palette), delay };
            previous = data;
        }
        if (held) write(held, written === 0);
        gif.finish();
        const bytes = gif.bytesView();
        return new Blob([new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)], { type: "image/gif" });
    } finally {
        URL.revokeObjectURL(src);
    }
}
