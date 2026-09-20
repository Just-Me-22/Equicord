/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { current, read } from "./classMap";

/** Everything the inspect lens reports beyond the plain box chain: which rule wins
 *  for a property and where it came from, which --* token feeds it, and how the
 *  parent is laying the element out. A screenshot cannot show any of these. */

/** properties worth resolving. sizing first, because that is what usually lies. */
const TRACKED = [
    "display", "position",
    "width", "min-width", "max-width",
    "height", "min-height", "max-height",
    "flex", "order", "grid-area",
    "margin-top", "margin-bottom", "margin-left", "margin-right",
    "padding-top", "padding-bottom", "padding-left", "padding-right",
    "background-color", "background-image", "color",
    "border-top", "border-bottom", "border-left", "border-right",
    "border-radius", "clip-path",
    "box-shadow", "mask-image", "opacity", "filter",
    // svg carries colour here rather than in background and color
    "fill", "stroke", "stroke-width",
    "overflow", "z-index"
];

/** read back as (ids, classes, elements), because a tie is only recognisable as a tie
 *  when you can see both sides of it. */
const specText = (n: number) => `(${Math.floor(n / 10000)},${Math.floor(n / 100) % 100},${n % 100})`;

/** rough CSS specificity. exact enough to rank two rules that both match. */
function specificity(sel: string): number {
    const ids = (sel.match(/#[\w-]+/g) ?? []).length;
    const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const els = (sel.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
    return ids * 10000 + cls * 100 + els;
}

/** the stylesheet a rule came from, named the way a person would recognise it */
function sourceOf(sheet: CSSStyleSheet | null): string {
    if (!sheet) return "(inline)";
    const node = sheet.ownerNode as HTMLElement | null;
    if (node?.id) return `<style #${node.id}>`;
    if (sheet.href) return sheet.href.split("/").pop() ?? sheet.href;
    // vencord injects themes and quickcss as bare style elements; the first
    // selector is the only thing that distinguishes them
    try {
        const first = (sheet.cssRules[0] as CSSStyleRule)?.selectorText;
        if (first) return `<style> starting "${first.slice(0, 24)}"`;
    } catch { /* cross-origin */ }
    return "<style>";
}

/** a nested rule's selectorText is relative: "&:hover" tested on its own matches
 *  every hovered element, whatever its parent rule was. folding the parent in is
 *  what stops an unrelated block being reported as the winner. */
function resolve(sel: string, scope: string): string {
    return sel.split(",").map(part => {
        const p = part.trim();
        return p.includes("&") ? p.replace(/&/g, `:is(${scope})`) : `:is(${scope}) ${p}`;
    }).join(", ");
}

interface Hit {
    value: string;
    important: boolean;
    spec: number;
    order: number;
    sel: string;
    src: string;
}

function collect(el: Element, out: Map<string, Hit[]>, pseudo = ""): { blocked: number; } {
    let order = 0;
    let blocked = 0;

    const visit = (rules: CSSRuleList, sheet: CSSStyleSheet, scope: string) => {
        for (const rule of Array.from(rules)) {
            const styleRule = rule as CSSStyleRule;
            const selector = styleRule.selectorText && scope
                ? resolve(styleRule.selectorText, scope)
                : styleRule.selectorText;

            if (selector) {
                let best = -1;
                // the part of the list that matched, not the whole list: discord groups
                // a dozen selectors on one rule and the truncated list hid which one
                let matched = "";
                for (const part of selector.split(",")) {
                    const sel = part.trim();
                    // a pseudo selector cannot be tested with matches, so the tail is
                    // stripped and the element itself is tested against what is left
                    const tail = sel.endsWith(pseudo) && pseudo ? sel.slice(0, -pseudo.length) : sel;
                    if (pseudo ? tail === sel : /::(before|after)/.test(sel)) continue;
                    try {
                        if (!el.matches(tail)) continue;
                        if (specificity(sel) < best) continue;
                        best = specificity(sel);
                        matched = sel;
                    } catch { /* & and other relative selectors */ }
                }
                if (best >= 0) {
                    order++;
                    for (const prop of TRACKED) {
                        const value = styleRule.style.getPropertyValue(prop);
                        if (!value) continue;
                        const list = out.get(prop) ?? [];
                        list.push({
                            value,
                            important: styleRule.style.getPropertyPriority(prop) === "important",
                            spec: best,
                            order,
                            sel: matched,
                            src: sourceOf(sheet)
                        });
                        out.set(prop, list);
                    }
                }
            }

            // an imported sheet is not in document.styleSheets and is reachable only
            // here. vencord loads every theme through @import, so skipping this hides
            // the theme's own rules from the whole report.
            const imported = (rule as CSSImportRule).styleSheet;
            if (imported) {
                try { visit(imported.cssRules, imported, scope); } catch { blocked++; }
                continue;
            }

            // media, supports, layer and nested blocks each hold rules of their own.
            // this runs after the rule above rather than instead of it: since css
            // nesting, a plain style rule reports an empty cssRules list too, and
            // treating that as "this is a grouping rule" skipped every rule there is.
            const nested = (rule as CSSGroupingRule).cssRules;
            if (nested?.length) visit(nested, sheet, selector || scope);
        }
    };

    for (const sheet of Array.from(document.styleSheets)) {
        try { visit(sheet.cssRules, sheet as CSSStyleSheet, ""); } catch { blocked++; }
    }

    // an inline style beats every rule, and means javascript is driving the value
    const inline = (el as HTMLElement).style;
    for (const prop of pseudo ? [] : TRACKED) {
        const value = inline.getPropertyValue(prop);
        if (!value) continue;
        const list = out.get(prop) ?? [];
        list.push({
            value,
            important: inline.getPropertyPriority(prop) === "important",
            spec: 1_000_000,
            order: 1_000_000,
            sel: "(element style attribute)",
            src: "INLINE - set by javascript"
        });
        out.set(prop, list);
    }

    return { blocked };
}

/** which rule actually wins for each tracked property, and what feeds it */
export function winners(el: Element): string[] {
    const map = new Map<string, Hit[]>();
    const { blocked } = collect(el, map);
    const note = blocked ? [`${blocked} stylesheet${blocked > 1 ? "s" : ""} could not be read`] : [];
    if (!map.size) return ["no matching rules found", ...note];

    const cs = getComputedStyle(el as HTMLElement);
    const out: string[] = [];

    for (const prop of TRACKED) {
        const hits = map.get(prop);
        if (!hits?.length) continue;
        hits.sort((a, b) =>
            (+b.important - +a.important) || (b.spec - a.spec) || (b.order - a.order));
        const win = hits[0];

        out.push(`${prop.padEnd(17)}${cs.getPropertyValue(prop) || "(empty)"}`);
        out.push(`  won by  ${win.sel.slice(0, 58)}${win.important ? "  !important" : ""}  ${specText(win.spec)}`);
        out.push(`  from    ${win.src}`);

        // naming the rules that lost is the point: "beat 3 others" tells you a fight
        // happened, not who you are fighting, and the loser is usually your own line
        for (const lost of hits.slice(1, 5)) {
            // a tie lost on source order is the one worth shouting about: the loser is
            // written correctly and still does nothing, and no amount of changing its
            // value fixes that. one more class or attribute on the selector does.
            const tied = lost.important === win.important && lost.spec === win.spec;
            const why = lost.important === win.important
                ? (tied ? `TIE at ${specText(lost.spec)}, lost on source order` : `less specific ${specText(lost.spec)}`)
                : "not important";
            out.push(`  ${tied ? "TIE " : "beat"}    ${lost.sel.slice(0, 48)}   ${lost.value.trim().slice(0, 20)}   ${why}`);
        }
        if (hits.length > 5) out.push(`  beat    and ${hits.length - 5} more`);

        // a var() in the winning declaration names the token to edit
        for (const token of win.value.match(/--[\w-]+/g) ?? []) {
            out.push(`  token   ${token} = ${cs.getPropertyValue(token).trim() || "(unset here)"}`);
        }
        out.push("");
    }
    out.push(...note);
    return out.length ? out : ["nothing tracked is set on this element"];
}

/** how the parent is laying this element out. grid and flex fail in ways the box
 *  numbers alone never explain - a pinned track, a gap, an order. */
export function layout(el: Element): string[] {
    const parent = el.parentElement;
    if (!parent) return ["no parent"];

    const p = getComputedStyle(parent);
    const c = getComputedStyle(el as HTMLElement);
    const name = (typeof parent.className === "string" ? parent.className : "").slice(0, 46) || "(none)";

    const out = [
        `parent  .${name}`,
        `        display: ${p.display}`
    ];

    if (p.display.includes("grid")) {
        out.push(`        grid-template-columns: ${p.gridTemplateColumns}`);
        if (p.gridTemplateAreas !== "none") out.push(`        grid-template-areas:   ${p.gridTemplateAreas}`);
        out.push(`        gap: ${p.rowGap} ${p.columnGap}`);
        out.push("", `this element  grid-area: ${c.gridArea}`);
        if (p.gridTemplateColumns === "subgrid") {
            out.push("", "parent is a SUBGRID - it cannot grow a track for an extra child.");
        }
    } else if (p.display.includes("flex")) {
        out.push(`        flex-direction: ${p.flexDirection}   gap: ${p.rowGap} ${p.columnGap}`);
        out.push("", `this element  flex: ${c.flexGrow} ${c.flexShrink} ${c.flexBasis}   order: ${c.order}`);
    }

    // a matching min and max is a hard pin, and no amount of sizing a child moves it
    if (p.minWidth !== "0px" && p.minWidth === p.maxWidth) {
        out.push("", `parent is PINNED at ${p.minWidth} (min-width === max-width). it cannot widen.`);
    }
    if (c.minWidth !== "0px" && c.minWidth === c.maxWidth) {
        out.push("", `this element is PINNED at ${c.minWidth}. sizing it will do nothing.`);
    }
    return out;
}

/** Everything painting at a point, whether or not a click can reach it.
 *
 *  A click reports one element: the topmost thing that accepts hit testing. An overlay
 *  with pointer-events:none, and every ::before and ::after, are invisible to it. This
 *  walks the whole document instead and keeps anything whose box contains the point and
 *  that actually paints - which is what finds a gradient nobody can click on. */

const DISCORD_SHEET = /discord(app)?\.com\/assets\//i;

function referenced(text: string, into: Set<string>) {
    const find = /var\(\s*(--[\w-]+)/g;
    let hit: RegExpExecArray | null;
    while ((hit = find.exec(text))) into.add(hit[1]);
}

export function vars(el: Element): string[] {
    const names = new Set<string>();
    /** declared by a file you can edit */
    const yours = new Set<string>();
    /** reached for by a rule that lands on this element, discord's own included */
    const inPlay = new Set<string>();
    let blocked = 0;

    const chain: Element[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);

    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            blocked++;
            continue;
        }

        const local = !sheet.href || !DISCORD_SHEET.test(sheet.href);

        for (const rule of Array.from(rules)) {
            const styleRule = rule as CSSStyleRule;
            const selector = styleRule.selectorText;
            if (!selector || !styleRule.style) continue;

            // :root and html reach everything, so they count without a match test
            const global = /^\s*(:root|html)\b/.test(selector);
            let reaches = global;

            if (!reaches) {
                for (const part of selector.split(",")) {
                    const sel = part.trim();
                    try {
                        if (chain.some(node => node.matches(sel))) { reaches = true; break; }
                    } catch { /* relative selectors the browser will not test standalone */ }
                }
            }
            if (!reaches) continue;

            for (let i = 0; i < styleRule.style.length; i++) {
                const prop = styleRule.style[i];
                if (!prop.startsWith("--")) continue;

                names.add(prop);
                if (local) yours.add(prop);
            }
            for (let i = 0; i < styleRule.style.length; i++) {
                const prop = styleRule.style[i];
                if (!prop.startsWith("--")) referenced(styleRule.style.getPropertyValue(prop), inPlay);
            }
        }
    }

    if (!names.size) {
        return ["nothing declares a custom property that reaches this element", ...(blocked ? [`${blocked} stylesheets could not be read`] : [])];
    }

    // an inline style is where discord names the token it is actually using
    referenced((el as HTMLElement).getAttribute("style") ?? "", inPlay);

    // both discord and a theme declare thousands of tokens that reach every element, so
    // "declared nearby" is not a filter: on a message row it left 2211 of them. only a
    // token some rule landing here actually reaches for is worth showing, and a leading
    // dot marks the ones a file you can edit declares.
    const worth = [...names].filter(name => inPlay.has(name)).sort();
    const buried = names.size - worth.length;

    const cs = getComputedStyle(el as HTMLElement);
    const rows: string[] = [];
    const empty: string[] = [];

    for (const name of worth) {
        const value = cs.getPropertyValue(name).trim();
        if (value) rows.push(`${yours.has(name) ? "." : " "} ${name.padEnd(38)}${value}`);
        else empty.push(name);
    }

    const out = [`${rows.length} reached for by the rules that land here. a leading dot is yours to edit.`, ""];
    out.push(...rows);

    if (buried) {
        out.push("", `${buried} more are declared somewhere above but nothing here reaches for them.`);
    }

    if (empty.length) {
        out.push("", `declared somewhere above but empty here: ${empty.slice(0, 12).join(", ")}${empty.length > 12 ? ` and ${empty.length - 12} more` : ""}`);
    }
    if (blocked) out.push("", `${blocked} stylesheets could not be read, so this may be short`);

    out.push("", "paste one into the css lens to try a different value without a rebuild");
    return out;
}

/** box and layout first, because that is what people are actually asking about when
 *  two things that should look the same do not */

/** a bar, a dot or a badge is usually a ::before, and nothing about it shows up when
 *  you inspect the element it hangs off. this reports both pseudo elements the same
 *  way winners reports the element itself. */
export function pseudo(el: Element): string[] {
    const out: string[] = [];

    for (const which of ["::before", "::after"] as const) {
        const cs = getComputedStyle(el as HTMLElement, which);
        if (cs.content === "none" || !cs.content) continue;

        const map = new Map<string, Hit[]>();
        collect(el, map, which);

        out.push(which, "");
        for (const prop of TRACKED) {
            const value = cs.getPropertyValue(prop);
            if (!value || value === "none" || value === "auto" || value === "normal") continue;

            out.push(`  ${prop.padEnd(17)}${value}`);
            const hits = map.get(prop);
            if (!hits?.length) continue;
            hits.sort((a, b) => (+b.important - +a.important) || (b.spec - a.spec) || (b.order - a.order));
            out.push(`    won by  ${hits[0].sel.slice(0, 56)}`);
            out.push(`    from    ${hits[0].src}`);
            for (const token of hits[0].value.match(/--[\w-]+/g) ?? []) {
                out.push(`    token   ${token} = ${cs.getPropertyValue(token).trim() || "(unset here)"}`);
            }
        }
        out.push("");
    }

    return out.length ? out : ["neither ::before nor ::after draws anything here"];
}

/** selectors you can paste into a theme. #app-mount adds an id, which is what lifts a
 *  rule over discord's own class-only ones without reaching for !important. the second
 *  form drops the hash, so it survives the next discord build at the cost of also
 *  matching any other module that happens to use the same name. */
export function selector(el: Element): string[] {
    const named = read(el).filter(one => one.name);
    if (!named.length) return ["this element carries no class the map knows"];

    const { hash } = current();
    const out: string[] = [];

    for (const one of named) {
        const sharing = hash.get(one.name ?? "")?.length ?? 1;
        out.push(`${one.name} ${"-".repeat(Math.max(2, 40 - (one.name?.length ?? 0)))}`);
        out.push(`  exact     #app-mount .${one.token}`);
        out.push(sharing > 1
            ? `  loose     #app-mount [class*="${one.stem}"]   careful: ${sharing} modules use this name`
            : `  loose     #app-mount [class*="${one.stem}"]   survives a rebuild`);
        out.push("");
    }

    out.push("exact breaks on the next discord build. loose survives it, but matches every");
    out.push("module using that name, so check the count before reaching for one.");
    return out;
}

/** the chain from the element up to the app root, named. a wrong pick is otherwise a
 *  dead end: you cannot tell what you are inside, only what you hit. */
/** an ancestor becomes the containing block for a fixed descendant, and a stacking
 *  context for everything under it, just by carrying one of these - which is how an
 *  element whose offsets all resolve correctly still lands somewhere else. */
const holdsFixed = (cs: CSSStyleDeclaration) =>
    cs.transform !== "none" || cs.filter !== "none" || cs.backdropFilter !== "none"
    || cs.perspective !== "none" || /layout|paint/.test(cs.contain)
    || /transform|filter|perspective/.test(cs.willChange);

const stacks = (cs: CSSStyleDeclaration) =>
    holdsFixed(cs) || cs.isolation === "isolate" || cs.mixBlendMode !== "normal"
    || Number(cs.opacity) < 1
    || (cs.position !== "static" && cs.zIndex !== "auto")
    || cs.position === "fixed" || cs.position === "sticky";

const scrolls = (cs: CSSStyleDeclaration) =>
    /auto|scroll|overlay/.test(cs.overflowY) || /auto|scroll|overlay/.test(cs.overflowX);

const clips = (cs: CSSStyleDeclaration) =>
    /hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflowY);

/** the token, not the name: a rule has to be written against the class that is
 *  actually on the element, and the two differ by an underscore often enough */
export const label = (node: Element) => {
    const named = read(node).filter(one => one.name).map(one => one.token).join(".");
    return node.tagName.toLowerCase() + (named ? `.${named}` : "");
};

export function path(el: Element): string[] {
    const self = getComputedStyle(el as HTMLElement);

    const chain: Element[] = [];
    for (let node: Element | null = el; node && chain.length < 14; node = node.parentElement) {
        chain.push(node);
        if (node.id === "app-mount") break;
    }

    // what an offset on this element is actually measured against. absolute stops at the
    // first positioned ancestor, fixed ignores position entirely and stops only at a
    // transform or a filter, and taking the wrong one of those for the other is what puts
    // a panel somewhere else while every number you wrote resolves correctly.
    let holder: Element | null = null;
    if (self.position === "absolute" || self.position === "fixed") {
        for (const node of chain.slice(1)) {
            const cs = getComputedStyle(node as HTMLElement);
            const holds = self.position === "fixed" ? holdsFixed(cs) : (cs.position !== "static" || holdsFixed(cs));
            if (holds) { holder = node; break; }
        }
    }

    let scroller: Element | null = null;
    for (const node of chain.slice(1)) {
        if (scrolls(getComputedStyle(node as HTMLElement))) { scroller = node; break; }
    }

    const head = [`this element  position: ${self.position}`];
    // its own clipping, which the tags below deliberately skip for the element you picked
    // and which is exactly what hides a child drawn outside it
    if (clips(self)) head.push(`               overflow: ${self.overflowX} ${self.overflowY}, so it clips its own children`);
    if (self.position === "absolute" || self.position === "fixed") {
        head.push(`measured against  ${holder ? label(holder) : "the viewport"}`);
    }
    head.push(`scroll parent     ${scroller ? label(scroller) : "none, nothing above this scrolls"}`, "");

    const tree = chain.map((node, depth) => {
        const box = node.getBoundingClientRect();
        const cs = getComputedStyle(node as HTMLElement);
        const tags: string[] = [];

        if (node === holder) tags.push("CONTAINING BLOCK");
        if (depth && scrolls(cs)) tags.push("scrolls");
        if (depth && clips(cs)) tags.push("clips");
        if (depth && stacks(cs)) tags.push("stacking context");

        return `${"  ".repeat(depth)}${label(node)}   ${Math.round(box.width)}x${Math.round(box.height)}`
            + `   x ${Math.round(box.left)} y ${Math.round(box.top)}`
            + (tags.length ? `   [${tags.join("] [")}]` : "");
    });

    return [...head, ...tree];
}

/** what is inside, which path cannot show: it only walks upward.
 *
 *  the attributes come with it on purpose. svg carries meaning in mask, fill and d rather
 *  than in classes, so a status indicator, a badge and a decoration are indistinguishable
 *  by class name and obvious by attribute. */
const TELLING = ["mask", "fill", "stroke", "d", "href", "style", "aria-label", "width", "height"];

export function inside(el: Element, limit = 60): string[] {
    const out: string[] = [];

    const walk = (node: Element, depth: number) => {
        for (const kid of Array.from(node.children)) {
            if (out.length >= limit) return;

            const box = kid.getBoundingClientRect();
            const bits = TELLING
                .map(attr => [attr, kid.getAttribute(attr)] as const)
                .filter(([, value]) => value)
                .map(([attr, value]) => `${attr}="${value!.length > 140 ? `${value!.slice(0, 140)}…` : value}"`);

            out.push(`${"  ".repeat(depth)}${label(kid)}   ${Math.round(box.width)}x${Math.round(box.height)}`
                + (bits.length ? `   ${bits.join(" ")}` : ""));

            walk(kid, depth + 1);
        }
    };

    walk(el, 0);

    if (out.length >= limit) out.push(`... stopped at ${limit} elements`);
    return out.length ? out : ["nothing inside this element"];
}

/** everything the click actually landed on top of, deepest first.
 *
 *  hit testing returns one element: the topmost thing that takes pointer events. a status
 *  dot, a badge, a gradient and every decoration discord paints with pointer-events none
 *  are invisible to it, and the click lands on the box behind them - which is why aiming
 *  harder never works. this walks the subtree by geometry instead, so those come back. */
export function atPoint(el: Element, x: number, y: number): Element[] {
    const hits: { node: Element; area: number; }[] = [];

    for (const node of [el, ...Array.from(el.querySelectorAll("*"))]) {
        const box = node.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;

        const cs = getComputedStyle(node);
        if (cs.visibility === "hidden" || cs.display === "none") continue;

        hits.push({ node, area: box.width * box.height });
    }

    // smallest first: the thing you were aiming at is the thing that barely covers
    // the point, and the wrapper you kept hitting is the largest
    return hits.sort((a, b) => a.area - b.area).map(one => one.node).slice(0, 12);
}

/** two elements side by side. an alignment read off a screenshot is a guess at a
 *  number. read off both boxes it is the number. */
export function compare(a: Element, b: Element): string[] {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const ca = getComputedStyle(a as HTMLElement);
    const cb = getComputedStyle(b as HTMLElement);

    const out = [`A  ${label(a)}`, `B  ${label(b)}`, "", `${"".padEnd(10)}${"A".padEnd(11)}${"B".padEnd(11)}B - A`];

    const edges: [string, number, number][] = [
        ["left", ra.left, rb.left], ["right", ra.right, rb.right],
        ["top", ra.top, rb.top], ["bottom", ra.bottom, rb.bottom],
        ["width", ra.width, rb.width], ["height", ra.height, rb.height]
    ];

    for (const [name, x, y] of edges) {
        const d = Math.round(y - x);
        out.push(`${name.padEnd(10)}${String(Math.round(x)).padEnd(11)}${String(Math.round(y)).padEnd(11)}`
            + (d === 0 ? "aligned" : `${d > 0 ? "+" : ""}${d}`));
    }

    const differs = TRACKED.filter(prop => ca.getPropertyValue(prop) !== cb.getPropertyValue(prop));
    out.push("", differs.length ? "differing properties" : "every tracked property matches");
    for (const prop of differs) {
        out.push(`${prop.padEnd(17)}A ${ca.getPropertyValue(prop)}`);
        out.push(`${"".padEnd(17)}B ${cb.getPropertyValue(prop)}`);
    }

    return out;
}
