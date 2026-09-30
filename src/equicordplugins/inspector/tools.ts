/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { cache } from "@webpack";

import { current, read } from "./classMap";
import { fetchedSheets } from "./rules";

const DISCORD_SHEET = /discord(app)?\.com\/assets\//i;

function eachRule(rules: CSSRuleList, visit: (rule: CSSStyleRule) => void) {
    for (const rule of Array.from(rules)) {
        if ((rule as CSSStyleRule).selectorText) visit(rule as CSSStyleRule);
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested?.length) eachRule(nested, visit);
    }
}

function ownSheets(): { sheet: CSSStyleSheet; name: string; }[] {
    const out: { sheet: CSSStyleSheet; name: string; }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.href && DISCORD_SHEET.test(sheet.href)) continue;
        try {
            void sheet.cssRules;
            const node = sheet.ownerNode as HTMLElement | null;
            out.push({ sheet, name: node?.id ? `<style #${node.id}>` : sheet.href?.split("/").pop() ?? "<style>" });
        } catch { /* cross-origin, read through the fetched copy below */ }
    }
    for (const { sheet, name } of fetchedSheets()) out.push({ sheet, name });
    return out;
}

function compoundAround(sel: string, at: number): string {
    let start = at;
    let depth = 0;
    for (let i = at - 1; i >= 0; i--) {
        const c = sel[i];
        if (c === ")" || c === "]") depth++;
        else if (c === "(" || c === "[") depth--;
        else if (depth === 0 && /[\s>+~]/.test(c)) break;
        start = i;
    }

    let end = at;
    depth = 0;
    for (let i = at; i < sel.length; i++) {
        const c = sel[i];
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;
        else if (depth === 0 && /[\s>+~,]/.test(c)) break;
        end = i + 1;
    }
    return sel.slice(start, end);
}

function withoutHas(compound: string): string {
    let out = "";
    for (let i = 0; i < compound.length; i++) {
        if (!compound.startsWith(":has(", i)) {
            out += compound[i];
            continue;
        }
        let depth = 0;
        for (; i < compound.length; i++) {
            if (compound[i] === "(") depth++;
            else if (compound[i] === ")" && --depth === 0) break;
        }
    }
    return out.trim();
}

export function hasRules(el: Element): string[] {
    const chain: Element[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);

    const found: { sel: string; anchor: string; count: number; here: boolean; src: string; }[] = [];
    for (const { sheet, name } of ownSheets()) {
        eachRule(sheet.cssRules, rule => {
            for (const part of rule.selectorText.split(",")) {
                const sel = part.trim();
                const at = sel.indexOf(":has(");
                if (at < 0) continue;
                const anchor = withoutHas(compoundAround(sel, at)) || "*";
                let count = -1;
                let here = false;
                try {
                    count = document.querySelectorAll(anchor).length;
                    here = chain.some(node => node.matches(anchor));
                } catch { /* a pseudo the browser will not test on its own */ }
                found.push({ sel, anchor, count, here, src: name });
            }
        });
    }

    if (!found.length) return ["none of your stylesheets use :has()"];

    found.sort((a, b) => +b.here - +a.here || b.count - a.count);
    const out = [`${found.length} :has() selectors in your stylesheets. the anchor is what gets re-checked on every change inside it.`, ""];
    for (const one of found.slice(0, 40)) {
        const flag = one.anchor === "*" ? "  FEATURELESS" : one.count > 200 ? "  WIDE" : "";
        out.push(`${one.here ? "here " : "     "}anchor  ${one.anchor.slice(0, 60)}   matches ${one.count < 0 ? "?" : one.count}${flag}`);
        out.push(`       ${one.sel.slice(0, 90)}`);
        out.push(`       from  ${one.src}`);
    }
    if (found.length > 40) out.push("", `and ${found.length - 40} more`);
    return out;
}

function cssFileOf(tokens: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const wanted = new Set(tokens);
    for (const sheet of Array.from(document.styleSheets)) {
        if (!wanted.size) break;
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        const name = sheet.href?.split("/").pop() ?? ((sheet.ownerNode as HTMLElement | null)?.id ? `<style #${(sheet.ownerNode as HTMLElement).id}>` : "<style>");
        eachRule(rules, rule => {
            for (const token of wanted) {
                if (!rule.selectorText.includes(`.${token}`)) continue;
                out.set(token, name);
                wanted.delete(token);
            }
        });
    }
    return out;
}

export function owners(el: Element): string[] {
    const { owner } = current();
    const tokens = Array.from(el.classList);
    if (!tokens.length) return ["this element carries no classes"];

    const files = cssFileOf(tokens);
    const out: string[] = [];
    for (const token of tokens) {
        const from = owner.get(token);
        out.push(`.${token}`);
        if (!from) {
            out.push("  not exported by any loaded webpack module", `  css   ${files.get(token) ?? "no stylesheet names it"}`, "");
            continue;
        }

        const exports = cache[from.module]?.exports as Record<string, unknown> | undefined;
        const holder = exports && typeof exports[from.key] === "string" ? exports : (exports?.default as Record<string, unknown> | undefined);
        const siblings = Object.keys(holder ?? {}).filter(key => key !== from.key && typeof holder![key] === "string").slice(0, 2);
        out.push(`  module ${from.module}   export ${from.key}`);
        out.push(`  find   findCssClassesLazy(${[from.key, ...siblings].map(key => `"${key}"`).join(", ")})`);
        out.push(`  css    ${files.get(token) ?? "no stylesheet names it"}`, "");
    }
    return out;
}

function summary(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}…` : value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
    if (typeof value === "function") return `fn ${value.name || ""}`.trim();
    if (Array.isArray(value)) return `[${value.length}]`;
    if (typeof value === "object" && "$$typeof" in (value as object)) return "<element>";
    return `{${Object.keys(value as object).length} keys}`;
}

function componentName(type: any): string {
    return type?.displayName || type?.name || type?.render?.displayName || type?.render?.name
        || type?.type?.displayName || type?.type?.name || "anonymous";
}

export function react(el: Element): string[] {
    const key = Object.keys(el).find(one => one.startsWith("__reactFiber$"));
    let fiber = key ? (el as any)[key] : null;
    if (!fiber) return ["react does not own this element"];

    const out: string[] = [];
    let found = 0;
    for (let hops = 0; fiber && found < 3 && hops < 60; hops++, fiber = fiber.return) {
        if (!fiber.type || typeof fiber.type === "string") continue;
        found++;

        out.push(componentName(fiber.type));
        const props = Object.entries(fiber.memoizedProps ?? {}).filter(([prop]) => prop !== "children");
        for (const [prop, value] of props.slice(0, 24)) out.push(`  ${prop.padEnd(24)}${summary(value)}`);
        if (props.length > 24) out.push(`  and ${props.length - 24} more props`);

        const state: string[] = [];
        if (fiber.stateNode?.state) {
            for (const [name, value] of Object.entries(fiber.stateNode.state).slice(0, 8)) state.push(`${name} ${summary(value)}`);
        } else {
            for (let hook = fiber.memoizedState, n = 0; hook && n < 8; hook = hook.next, n++) {
                const value = hook.memoizedState;
                if (value === null || ["string", "number", "boolean"].includes(typeof value)) state.push(summary(value));
            }
        }
        if (state.length) out.push(`  state   ${state.join("   ")}`);
        out.push("");
    }
    return out.length ? out : ["no component found above this element"];
}

export function watch(el: Element, push: (line: string) => void): () => void {
    const started = performance.now();
    const stamp = () => `+${Math.round(performance.now() - started)}ms`.padEnd(9);
    let classes = new Set(el.classList);
    let size = el.getBoundingClientRect();

    const mutations = new MutationObserver(records => {
        for (const record of records) {
            if (record.attributeName === "class") {
                const now = new Set(el.classList);
                const added = [...now].filter(one => !classes.has(one));
                const removed = [...classes].filter(one => !now.has(one));
                classes = now;
                if (added.length || removed.length) push(`${stamp()}class  ${added.map(one => `+${one}`).join(" ")} ${removed.map(one => `-${one}`).join(" ")}`.trimEnd());
            } else if (record.attributeName === "style") {
                push(`${stamp()}style  ${((el as HTMLElement).getAttribute("style") ?? "").slice(0, 120)}`);
            } else {
                push(`${stamp()}${record.type === "childList" ? `children  +${record.addedNodes.length} -${record.removedNodes.length}` : record.attributeName}`);
            }
        }
    });
    mutations.observe(el, { attributes: true, childList: true });

    const sizes = new ResizeObserver(() => {
        const now = el.getBoundingClientRect();
        if (Math.round(now.width) === Math.round(size.width) && Math.round(now.height) === Math.round(size.height)) return;
        push(`${stamp()}size   ${Math.round(size.width)}x${Math.round(size.height)} -> ${Math.round(now.width)}x${Math.round(now.height)}`);
        size = now;
    });
    sizes.observe(el);

    return () => {
        mutations.disconnect();
        sizes.disconnect();
    };
}

export function record(el: Element, ms = 1000): Promise<string[]> {
    return new Promise(done => {
        const started = performance.now();
        const frames: string[] = [];
        let previous = "";

        const sample = () => {
            const at = performance.now() - started;
            const box = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const now = `${Math.round(box.left)},${Math.round(box.top)}  ${Math.round(box.width)}x${Math.round(box.height)}  opacity ${cs.opacity}  transform ${cs.transform === "none" ? "none" : cs.transform.slice(0, 60)}`;
            if (now !== previous) frames.push(`${`${Math.round(at)}ms`.padEnd(8)}${now}`);
            previous = now;
            if (at < ms) requestAnimationFrame(sample);
            else done(frames.length > 1 ? [`${frames.length} different frames in ${ms}ms`, "", ...frames] : ["nothing moved or changed while recording", "", ...frames]);
        };
        requestAnimationFrame(sample);
    });
}

export function restyleCost(el: Element): string[] {
    const node = el as HTMLElement;
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
        node.classList.add("vc-inspector-probe");
        const started = performance.now();
        void node.offsetWidth;
        times.push(performance.now() - started);
        node.classList.remove("vc-inspector-probe");
        void node.offsetWidth;
    }
    times.sort((a, b) => a - b);
    const median = times[3];
    return [
        `a class change here costs about ${median.toFixed(2)}ms of style and layout (median of 7)`,
        `fastest ${times[0].toFixed(2)}ms, slowest ${times[6].toFixed(2)}ms, ${el.querySelectorAll("*").length} elements inside`
    ];
}

const KEEP = [
    "display", "position", "top", "right", "bottom", "left", "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin", "padding", "box-sizing", "background", "color", "font", "letter-spacing", "line-height", "text-align", "text-transform",
    "text-overflow", "white-space", "border", "border-radius", "box-shadow", "outline", "opacity", "transform", "overflow",
    "flex", "flex-direction", "flex-wrap", "align-items", "align-self", "justify-content", "gap", "order",
    "grid-template-columns", "grid-template-rows", "grid-area", "z-index", "object-fit", "fill", "stroke", "mask", "filter"
];

export function exportHtml(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    const originals = [el, ...Array.from(el.querySelectorAll("*"))].slice(0, 600);
    const copies = [clone, ...Array.from(clone.querySelectorAll("*"))].slice(0, 600);

    originals.forEach((original, i) => {
        const cs = getComputedStyle(original);
        const style = KEEP.map(prop => `${prop}:${cs.getPropertyValue(prop)}`).join(";");
        copies[i].setAttribute("style", style);
        copies[i].removeAttribute("class");
    });

    const page = getComputedStyle(document.body);
    return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${el.tagName.toLowerCase()}</title></head>\n`
        + `<body style="margin:24px;background:${page.backgroundColor};font-family:${page.fontFamily}">\n${clone.outerHTML}\n</body></html>\n`;
}

export function hashDiff(previous: { file: string; text: string; }, el: Element): string[] {
    const before = new Map<string, string>();
    const section = previous.text.split("=== Selector ===")[0];
    for (const match of section.matchAll(/^\.(\S+)\s+is (\S+)/gm)) before.set(match[2], match[1]);

    const changed: string[] = [];
    const same: string[] = [];
    for (const one of read(el)) {
        if (!one.name) continue;
        const old = before.get(one.name);
        if (!old) continue;
        if (old === one.token) same.push(one.name);
        else changed.push(`${one.name.padEnd(30)}${old}  ->  ${one.token}`);
    }

    const out = [`compared with ${previous.file}`, ""];
    if (changed.length) out.push("changed since then", ...changed.map(line => `  ${line}`), "");
    out.push(same.length ? `unchanged  ${same.join(", ")}` : "no class names in common");
    return out;
}
