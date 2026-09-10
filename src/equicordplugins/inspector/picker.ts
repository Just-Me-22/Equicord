/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { read } from "./classMap";

const LAYER = "vc-inspector-layer";

let layer: HTMLElement | null = null;
let picked: ((el: Element) => void) | null = null;
let hovered: Element | null = null;
let frame = 0;

function surface(): HTMLElement {
    if (layer?.isConnected) return layer;
    layer = document.createElement("div");
    layer.id = LAYER;
    layer.style.cssText = "position:fixed;inset:0;z-index:10000;pointer-events:none";
    document.body.appendChild(layer);
    return layer;
}

/** boxes are positioned with transform so moving one across the screen never touches
 *  layout, which matters because this runs on every pointer move while armed */
function box(rect: DOMRect, solid: boolean): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;box-sizing:border-box;" +
        `transform:translate(${rect.left}px,${rect.top}px);` +
        `width:${rect.width}px;height:${rect.height}px;` +
        `border:1px solid ${solid ? "#e5a0b8" : "#e5a0b866"};` +
        "background:rgba(229,160,184,0.14)";
    return el;
}

/** draws a box over each element and leaves it there */
export function outline(els: Element[]) {
    const on = surface();
    on.replaceChildren(...els.map(el => box(el.getBoundingClientRect(), false)));
}

export function clear() {
    layer?.replaceChildren();
}

/** the overlay is ours, so hovering it is not a pick */
function under(e: PointerEvent): Element | null {
    const el = e.target as Element | null;
    if (!el?.closest) return null;
    return el.closest(`#${LAYER}`) ? null : el;
}

/** the selector you would get if you clicked, sitting on the outline. without it you are
 *  aiming at a rectangle and only find out what you hit after the modal opens. */
function label(el: Element, rect: DOMRect): HTMLElement {
    const named = read(el).filter(one => one.name);
    const tag = document.createElement("div");
    tag.textContent = `${el.tagName.toLowerCase()}${named.map(one => `.${one.token}`).join("")}` +
        `   ${Math.round(rect.width)}x${Math.round(rect.height)}`;

    // above the box, unless it is against the top of the window
    const below = rect.top < 24;
    tag.style.cssText = "position:absolute;left:0;top:0;max-width:70vw;overflow:hidden;" +
        `transform:translate(${Math.max(0, rect.left)}px,${below ? rect.bottom + 3 : rect.top - 21}px);` +
        "padding:2px 7px;border-radius:3px;white-space:nowrap;text-overflow:ellipsis;" +
        "background:#e5a0b8;color:#241018;font:600 11px var(--font-code, monospace)";
    return tag;
}

function move(e: PointerEvent) {
    const el = under(e);
    if (!el || el === hovered) return;
    hovered = el;
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        if (!hovered) return;
        const rect = hovered.getBoundingClientRect();
        surface().replaceChildren(box(rect, true), label(hovered, rect));
    });
}

/** picking happens on pointerdown, so the click that follows the same press would land
 *  on whatever the pick just opened and dismiss it. this eats that one click. */
function swallow(e: MouseEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.removeEventListener("click", swallow, true);
}

function take(e: MouseEvent) {
    const el = under(e as unknown as PointerEvent);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    document.addEventListener("click", swallow, true);
    const done = picked;
    disarm();
    done?.(el);
}

function key(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    disarm();
}

export function arm(onPick: (el: Element) => void) {
    if (picked) disarm();
    picked = onPick;
    document.addEventListener("pointermove", move, true);
    // pointerdown, not click: a scrollbar, a drag region and anything that calls
    // preventDefault on the way down never produce a click, so those were unpickable
    document.addEventListener("pointerdown", take, true);
    document.addEventListener("keydown", key, true);
}

export function disarm() {
    picked = null;
    hovered = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerdown", take, true);
    document.removeEventListener("keydown", key, true);
    clear();
}

export function armed() {
    return picked !== null;
}

/** a still of the element, scaled to fit. the clone renders off the same stylesheets so
 *  it looks like the real thing, but it is a snapshot and carries no behaviour.
 *
 *  a bar or a dot is a few pixels across and a picture of it on its own says nothing, so
 *  small elements are shown inside the nearest ancestor big enough to place them, with
 *  the one you picked outlined. */
export function thumbnail(el: Element, into: HTMLElement, width: number, height: number) {
    let host = el;
    for (let hop = 0; hop < 4 && host.parentElement; hop++) {
        const box = host.getBoundingClientRect();
        if (box.width >= 220 && box.height >= 28) break;
        host = host.parentElement;
    }

    const frame = host.getBoundingClientRect();
    const spot = el.getBoundingClientRect();
    if (!frame.width || !frame.height) {
        into.replaceChildren();
        return;
    }

    const scale = Math.min(width / frame.width, height / frame.height, 3);
    const clone = host.cloneNode(true) as HTMLElement;
    clone.style.position = "static";
    clone.style.margin = "0";
    clone.style.width = `${frame.width}px`;
    clone.style.height = `${frame.height}px`;
    clone.style.transform = `scale(${scale})`;
    clone.style.transformOrigin = "top left";

    const stage = document.createElement("div");
    stage.style.cssText = "position:relative;transform-origin:top left";
    stage.appendChild(clone);

    if (host !== el && spot.width && spot.height) {
        const mark = document.createElement("div");
        mark.style.cssText = "position:absolute;pointer-events:none;box-sizing:border-box;" +
            `left:${(spot.left - frame.left) * scale}px;top:${(spot.top - frame.top) * scale}px;` +
            `width:${Math.max(2, spot.width * scale)}px;height:${Math.max(2, spot.height * scale)}px;` +
            "outline:2px solid #e5a0b8;background:rgba(229,160,184,0.2)";
        stage.appendChild(mark);
    }

    into.style.cssText = `width:${frame.width * scale}px;height:${frame.height * scale}px;` +
        "overflow:hidden;pointer-events:none;border-radius:4px";
    into.replaceChildren(stage);
}
