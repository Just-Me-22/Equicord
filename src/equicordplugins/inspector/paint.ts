/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { atPoint, label } from "./rules";

type Rgba = [number, number, number, number];

let pen: CanvasRenderingContext2D | null = null;

function parse(colour: string): Rgba | null {
    pen ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    if (!pen || !CSS.supports("color", colour)) return null;
    pen.clearRect(0, 0, 1, 1);
    pen.fillStyle = colour;
    pen.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
}

const over = (top: Rgba, under: Rgba): Rgba => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (!a) return [0, 0, 0, 0];
    const mix = (i: number) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
    return [mix(0), mix(1), mix(2), a];
};

function luminance([r, g, b]: Rgba) {
    const part = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * part(r) + 0.7152 * part(g) + 0.0722 * part(b);
}

const ratio = (a: Rgba, b: Rgba) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const hex = ([r, g, b, a]: Rgba) =>
    `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}${a < 0.995 ? ` at ${Math.round(a * 100)}%` : ""}`;

const cut = (text: string, n: number) => text.length > n ? `${text.slice(0, n)}...` : text;

interface Backing { colour: Rgba; layers: number; images: string[]; solid: boolean; }

function backing(el: Element): Backing {
    let colour: Rgba = [0, 0, 0, 0];
    let layers = 0;
    const images: string[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage !== "none") images.push(label(node));
        const fill = parse(cs.backgroundColor);
        if (!fill || !fill[3]) continue;
        colour = over(colour, fill);
        layers++;
        if (colour[3] > 0.995) return { colour, layers, images, solid: true };
    }
    return { colour, layers, images, solid: false };
}

export function contrast(el: Element): string[] {
    const cs = getComputedStyle(el);
    const text = parse(cs.color);
    if (!text) return [`could not read the text colour ${cs.color}`];

    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const back = backing(el);
    const out = [
        `text            ${hex(text)}   ${Math.round(size)}px ${cs.fontWeight}`,
        `text shadow     ${cs.textShadow === "none" ? "none" : cut(cs.textShadow, 80)}`
    ];

    const verdict = (value: number) => `${value.toFixed(2)} : 1   ${value >= need ? "passes" : "FAILS"} ${need} for ${large ? "large" : "normal"} text`;

    if (back.solid) {
        out.push(`behind it       ${hex(back.colour)}   from ${back.layers} fill${back.layers === 1 ? "" : "s"}`);
        out.push(`ratio           ${verdict(ratio(over(text, back.colour), back.colour))}`);
    } else {
        const dark = over(back.colour, [0, 0, 0, 1]);
        const light = over(back.colour, [255, 255, 255, 1]);
        out.push(`behind it       ${back.layers ? `${hex(back.colour)}, then` : "no fill at all, so"} whatever shows through: an image, a wallpaper or the window`);
        out.push(`over black      ${verdict(ratio(over(text, dark), dark))}`);
        out.push(`over white      ${verdict(ratio(over(text, light), light))}`);
        out.push("the real ratio sits between those two, depending on what is behind the glass");
    }

    if (back.images.length) out.push("", `a background image on ${back.images.slice(0, 3).join(", ")} is in the way and is not counted`);
    return out;
}

const PAINTS: [string, (value: string) => boolean][] = [
    ["background-image", v => v !== "none"],
    ["opacity", v => v !== "1"],
    ["mask-image", v => v !== "none"],
    ["filter", v => v !== "none"],
    ["backdrop-filter", v => v !== "none"],
    ["mix-blend-mode", v => v !== "normal"],
    ["box-shadow", v => v !== "none"]
];

function paints(node: Element, pseudo?: string): string[] {
    const cs = getComputedStyle(node, pseudo);
    if (pseudo && (cs.content === "none" || cs.content === "normal")) return [];
    const out: string[] = [];
    const fill = parse(cs.backgroundColor);
    if (fill?.[3]) out.push(`background-color ${hex(fill)}`);
    for (const [prop, counts] of PAINTS) {
        const value = cs.getPropertyValue(prop);
        if (value && counts(value)) out.push(`${prop} ${cut(value, 110)}`);
    }
    if (cs.pointerEvents === "none" && !pseudo) out.push("pointer-events none");
    return out;
}

function painted(node: Element, indent: string): string[] {
    const out: string[] = [];
    const inline = (node as HTMLElement).style?.cssText ? "   [inline style]" : "";
    const own = paints(node);
    out.push(`${indent}${label(node)}${inline}${own.length ? "" : "   paints nothing"}`);
    for (const one of own) out.push(`${indent}    ${one}`);
    for (const pseudo of ["::before", "::after"]) {
        const drawn = paints(node, pseudo);
        if (!drawn.length) continue;
        out.push(`${indent}    ${pseudo}`);
        for (const one of drawn) out.push(`${indent}      ${one}`);
    }
    return out;
}

export function around(el: Element, x: number, y: number): Element[] {
    let root = el;
    const limit = innerWidth * innerHeight * 0.3;
    for (let hop = 0; hop < 6 && root.parentElement; hop++) {
        const box = root.parentElement.getBoundingClientRect();
        if (x < box.left || x > box.right || y < box.top || y > box.bottom || box.width * box.height > limit) break;
        root = root.parentElement;
    }
    return atPoint(root, x, y);
}

export function paintStack(el: Element, at?: { x: number; y: number; }): string[] {
    const out = ["this element and what is behind it, nearest first", ""];
    let hops = 0;
    for (let node: Element | null = el; node && hops < 14; node = node.parentElement, hops++) {
        out.push(...painted(node, hops ? "  " : ""));
    }

    if (at) {
        const here = around(el, at.x, at.y).filter(node => !node.contains(el));
        if (here.length) {
            out.push("", "also under the pointer, smallest first");
            for (const node of here) out.push(...painted(node, "  "));
        }
    }
    return out;
}

export function inlineStyles(el: Element, limit = 80): string[] {
    const out: string[] = [];
    const add = (node: Element, where: string) => {
        const text = (node as HTMLElement).style?.cssText;
        if (!text) return;
        out.push(`${where}${label(node)}`);
        for (const decl of text.split(";")) {
            const one = decl.trim();
            if (one) out.push(`    ${cut(one, 300)}`);
        }
    };

    const above: Element[] = [];
    for (let node = el.parentElement, hops = 0; node && hops < 6; node = node.parentElement, hops++) above.unshift(node);
    for (const node of above) add(node, "above  ");
    add(el, "this   ");
    for (const node of Array.from(el.querySelectorAll("[style]")).slice(0, limit)) add(node, "inside ");

    return out.length ? out : ["nothing here or within six ancestors carries an inline style"];
}

export const unclickable = (node: Element) => getComputedStyle(node).pointerEvents === "none";
