/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { read } from "./classMap";

const LAYER = "vc-inspector-layer";

let layer: HTMLElement | null = null;
let picked: ((el: Element, at: Point) => void) | null = null;

export interface Point { x: number; y: number; }
let hovered: Element | null = null;
let frame = 0;
let last: { x: number; y: number; target: Element | null; } | null = null;
let alt = false;
let shift = false;
/** the elements the wheel stepped up through, so stepping back down retraces them */
let trail: Element[] = [];
let reference: Element | null = null;

export function setReference(el: Element | null) {
    reference = el;
}

function surface(): HTMLElement {
    if (layer?.isConnected) return layer;
    layer = document.createElement("div");
    layer.id = LAYER;
    layer.className = "vc-inspector-layer";
    document.body.appendChild(layer);
    return layer;
}

function part(className: string): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    return el;
}

/** boxes are positioned with transform so moving one across the screen never touches
 *  layout, which matters because this runs on every pointer move while armed */
function place(el: HTMLElement, left: number, top: number, width: number, height: number) {
    el.style.transform = `translate(${left}px,${top}px)`;
    el.style.width = `${Math.max(0, width)}px`;
    el.style.height = `${Math.max(0, height)}px`;
}

function box(rect: DOMRect, solid: boolean): HTMLElement {
    const el = part(solid ? "vc-inspector-box" : "vc-inspector-box vc-inspector-box-faint");
    place(el, rect.left, rect.top, rect.width, rect.height);
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

const px = (value: string) => parseFloat(value) || 0;

/** the overlay is ours, so hovering it is not a pick. shift reaches the element under
 *  whatever is on top, which is how a backdrop or a click-eating wrapper gets passed. */
function under(x: number, y: number, target: EventTarget | null): Element | null {
    if (shift) {
        const stack = document.elementsFromPoint(x, y).filter(one => !one.closest(`#${LAYER}`));
        return stack[1] ?? stack[0] ?? null;
    }
    const el = target as Element | null;
    if (!el?.closest) return null;
    return el.closest(`#${LAYER}`) ? null : el;
}

/** the selector you would get if you clicked, sitting on the outline. without it you are
 *  aiming at a rectangle and only find out what you hit after the modal opens. */
function label(el: Element, rect: DOMRect): HTMLElement {
    const named = read(el).filter(one => one.name);
    const tag = part("vc-inspector-label");
    const size = part("vc-inspector-label-size");
    size.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    const name = part("vc-inspector-label-name");
    name.textContent = named.length ? named.map(one => one.name).join(" · ") : el.tagName.toLowerCase();
    tag.append(size, name);

    const inside = rect.top < 24;
    tag.style.transform = `translate(${Math.max(0, rect.left)}px,${inside ? rect.top + 3 : rect.top - 22}px)`;
    return tag;
}

let shapes: { margin: HTMLElement; padding: HTMLElement; border: HTMLElement; } | null = null;

function drawHover(el: Element) {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const on = surface();

    if (!shapes || !shapes.border.isConnected) {
        shapes = { margin: part("vc-inspector-margin"), padding: part("vc-inspector-padding"), border: part("vc-inspector-box") };
    }
    const { margin, padding, border } = shapes;

    const m = [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)];
    const p = [px(cs.paddingTop) + px(cs.borderTopWidth), px(cs.paddingRight) + px(cs.borderRightWidth), px(cs.paddingBottom) + px(cs.borderBottomWidth), px(cs.paddingLeft) + px(cs.borderLeftWidth)];

    place(margin, rect.left - m[3], rect.top - m[0], rect.width + m[1] + m[3], rect.height + m[0] + m[2]);
    margin.style.borderWidth = `${m[0]}px ${m[1]}px ${m[2]}px ${m[3]}px`;
    place(border, rect.left, rect.top, rect.width, rect.height);
    border.style.borderRadius = cs.borderRadius;
    place(padding, rect.left, rect.top, rect.width, rect.height);
    padding.style.borderWidth = `${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px`;
    padding.style.borderRadius = cs.borderRadius;

    const kids: HTMLElement[] = [margin, padding, border, label(el, rect)];
    if (alt && reference && reference !== el && reference.isConnected) kids.push(...measure(reference.getBoundingClientRect(), rect));
    on.replaceChildren(...kids);
}

function gapLine(x1: number, y1: number, x2: number, y2: number, text: string): HTMLElement[] {
    const line = part("vc-inspector-gap");
    place(line, Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) || 1, Math.abs(y2 - y1) || 1);
    const tag = part("vc-inspector-gap-label");
    tag.textContent = text;
    tag.style.transform = `translate(${(x1 + x2) / 2 + 4}px,${(y1 + y2) / 2 - 9}px)`;
    return [line, tag];
}

/** pixel distances from the reference box to the hovered one, edge to edge */
function measure(a: DOMRect, b: DOMRect): HTMLElement[] {
    const out = [box(a, false)];
    const midY = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
    const midX = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    const y = Number.isFinite(midY) && midY > 0 ? midY : b.top + b.height / 2;
    const x = Number.isFinite(midX) && midX > 0 ? midX : b.left + b.width / 2;

    if (b.left >= a.right) out.push(...gapLine(a.right, y, b.left, y, `${Math.round(b.left - a.right)}`));
    else if (a.left >= b.right) out.push(...gapLine(b.right, y, a.left, y, `${Math.round(a.left - b.right)}`));
    else out.push(...gapLine(a.left, y, b.left, y, `left ${Math.round(b.left - a.left)}`));

    if (b.top >= a.bottom) out.push(...gapLine(x, a.bottom, x, b.top, `${Math.round(b.top - a.bottom)}`));
    else if (a.top >= b.bottom) out.push(...gapLine(x, b.bottom, x, a.top, `${Math.round(a.top - b.bottom)}`));
    else out.push(...gapLine(x, a.top, x, b.top, `top ${Math.round(b.top - a.top)}`));
    return out;
}

function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        if (hovered?.isConnected) drawHover(hovered);
    });
}

function move(e: PointerEvent) {
    last = { x: e.clientX, y: e.clientY, target: e.target as Element | null };
    shift = e.shiftKey;
    const el = under(last.x, last.y, last.target);
    if (!el) return;
    if (el !== hovered && !trail.includes(el)) {
        trail = [];
        hovered = el;
    }
    schedule();
}

/** the wheel walks up to the parent and back down the same way, so a wrapper that
 *  covers its children exactly can still be told apart from them */
function wheel(e: WheelEvent) {
    if (!hovered) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.deltaY < 0) {
        const up = hovered.parentElement;
        if (!up || up === document.body) return;
        trail.push(hovered);
        hovered = up;
    } else {
        const down = trail.pop() ?? Array.from(hovered.children).find(kid => {
            const r = kid.getBoundingClientRect();
            return last && last.x >= r.left && last.x <= r.right && last.y >= r.top && last.y <= r.bottom;
        });
        if (!down) return;
        hovered = down;
    }
    schedule();
}

function modifier(e: KeyboardEvent) {
    if (e.key !== "Alt" && e.key !== "Shift") return;
    const down = e.type === "keydown";
    if (e.key === "Alt") {
        e.preventDefault();
        alt = down;
    } else {
        shift = down;
        const el = last && under(last.x, last.y, last.target);
        if (el) { hovered = el; trail = []; }
    }
    schedule();
}

/** picking happens on pointerdown, so the click that follows the same press would land
 *  on whatever the pick just opened and dismiss it. this eats that one click. */
function swallow(e: MouseEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.removeEventListener("click", swallow, true);
}

function take(e: MouseEvent) {
    shift = e.shiftKey;
    const el = trail.length ? hovered : under(e.clientX, e.clientY, e.target);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    document.addEventListener("click", swallow, true);
    const done = picked;
    disarm();
    // the point, not just the element: anything with pointer-events none is passed
    // straight through by hit testing, so the report needs the coordinate to find it
    done?.(el, { x: e.clientX, y: e.clientY });
}

function key(e: KeyboardEvent) {
    if (e.key !== "Escape") return modifier(e);
    e.preventDefault();
    e.stopImmediatePropagation();
    disarm();
}

export function arm(onPick: (el: Element, at: Point) => void) {
    if (picked) disarm();
    picked = onPick;
    document.addEventListener("pointermove", move, true);
    // pointerdown, not click: a scrollbar, a drag region and anything that calls
    // preventDefault on the way down never produce a click, so those were unpickable
    document.addEventListener("pointerdown", take, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("keyup", modifier, true);
    document.addEventListener("wheel", wheel, { capture: true, passive: false });
}

export function disarm() {
    picked = null;
    hovered = null;
    last = null;
    alt = false;
    shift = false;
    trail = [];
    shapes = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerdown", take, true);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("keyup", modifier, true);
    document.removeEventListener("wheel", wheel, { capture: true });
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
        const mark = part("vc-inspector-shot-mark");
        mark.style.left = `${(spot.left - frame.left) * scale}px`;
        mark.style.top = `${(spot.top - frame.top) * scale}px`;
        mark.style.width = `${Math.max(2, spot.width * scale)}px`;
        mark.style.height = `${Math.max(2, spot.height * scale)}px`;
        stage.appendChild(mark);
    }

    into.style.cssText = `width:${frame.width * scale}px;height:${frame.height * scale}px`;
    into.className = "vc-inspector-shot-frame";
    into.replaceChildren(stage);
}
