/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ExpandableSection } from "@components/ExpandableCard";
import { HeadingSecondary } from "@components/Heading";
import { PluginNative } from "@utils/types";
import { createRoot, React, Text, TextArea, TextInput, Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { read } from "./classMap";
import { cl, Lines } from "./lines";
import { arm, Point, setReference, thumbnail } from "./picker";
import { atPoint, compare, inside, label, layout, path, pseudo, selector, vars, warmRemoteSheets, winners } from "./rules";
import { exportHtml, hashDiff, hasRules, owners, react, record, restyleCost, watch } from "./tools";

const ICONS = {
    copy: "M8 3h9a2 2 0 0 1 2 2v11h-2V5H8V3Zm-3 4h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v10h9V9H5Z",
    pin: "M15 4V9l3 3v2h-5v7l-1 1-1-1v-7H6v-2l3-3V4H8V2h8v2z",
    compare: "M3 5h8v14H3V5Zm2 2v10h4V7H5Zm8-2h8v14h-8V5Zm2 2v10h4V7h-4Z",
    pick: "M11 2h2v3.1A7 7 0 0 1 18.9 11H22v2h-3.1A7 7 0 0 1 13 18.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1V2Zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    save: "M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 2v4h8V5H7Zm5 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    notes: "M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM8 12v2h8v-2H8Zm0 4v2h5v-2H8Z",
    watch: "M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    record: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
    timer: "M9 2h6v2H9V2Zm3 3a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm-1 2h2v4.6l3 1.8-1 1.7-4-2.4V9Z",
    html: "M8.6 7.4 4 12l4.6 4.6L7.2 18 1.2 12l6-6 1.4 1.4Zm6.8 0L20 12l-4.6 4.6 1.4 1.4 6-6-6-6-1.4 1.4Z",
    close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z",
    check: "M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"
} as const;

const Icon = ({ name }: { name: keyof typeof ICONS; }) => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={ICONS[name]} /></svg>
);

function Section({ title, lines, start, n, copied, onCopy }: {
    title: string;
    lines: string[];
    start?: boolean;
    n: number;
    copied: boolean;
    onCopy: () => void;
}) {
    const take = (e: React.MouseEvent) => {
        e.stopPropagation();
        onCopy();
    };

    return (
        <ExpandableSection
            initialExpanded={start === true}
            renderContent={() => <Lines lines={lines} section={title} />}
        >
            <div className={cl("section-head")}>
                <kbd className={cl("key", copied && "key-done")} onClick={take} title={n < 10 ? `Copy, or press ${n}` : "Copy"}>
                    {copied ? <Icon name="check" /> : n < 10 ? n : "·"}
                </kbd>
                <HeadingSecondary className={cl("section-title")}>{title}</HeadingSecondary>
                <span className={cl("count")}>{lines.length}</span>
            </div>
        </ExpandableSection>
    );
}

const TRY = "vc-inspector-try";

/** a live style tag rather than an inline style: it applies to everything the selector
 *  matches, so what you see is what the rule will do once it is in the theme. */
function Try({ el }: { el: Element; }) {
    const first = selector(el).find(line => line.trim().startsWith("#app-mount"))?.trim() ?? "";
    const [sel, setSel] = useState(first);
    const [body, setBody] = useState("");
    const [important, setImportant] = useState(false);

    const declarations = body.split(/[;\n]/).map(one => one.trim()).filter(one => one.includes(":"));
    const rule = sel && declarations.length
        ? `${sel} {\n${declarations.map(one => `    ${one.replace(/\s*!important\s*$/, "")}${important ? " !important" : ""};`).join("\n")}\n}`
        : "";

    useEffect(() => {
        const tag = document.getElementById(TRY) ?? document.head.appendChild(
            Object.assign(document.createElement("style"), { id: TRY })
        );
        tag.textContent = rule;
        return () => tag.remove();
    }, [rule]);

    return (
        <div className={cl("try")}>
            <TextInput value={sel} onChange={setSel} placeholder="#app-mount .thing" />
            <TextArea value={body} onChange={setBody} placeholder={"background-color: red\npadding: 4px"} rows={3} />
            <div className={cl("try-row")}>
                <label className={cl("try-toggle")}>
                    <input type="checkbox" checked={important} onChange={e => setImportant(e.currentTarget.checked)} />
                    !important
                </label>
                <button
                    type="button"
                    className={cl("text-button")}
                    disabled={!rule}
                    onClick={() => navigator.clipboard.writeText(rule).then(() => Toasts.show({ message: "Copied as QuickCSS", id: Toasts.genId(), type: Toasts.Type.SUCCESS }))}
                >
                    Copy as QuickCSS
                </button>
            </div>
            {rule && <Lines lines={rule.split("\n")} section="Try" />}
        </div>
    );
}

function Shot({ el }: { el: Element; }) {
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (box.current) thumbnail(el, box.current, 500, 170);
    }, [el]);

    return (
        <div className={cl("shot")}>
            <div ref={box} />
        </div>
    );
}

const cut = (text: string, n: number) => text.length > n ? `${text.slice(0, n)}…` : text;

function element(el: Element): string[] {
    const named = read(el);
    const out = [el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "")];

    for (const one of named) out.push(`.${one.token}${one.name ? `   is ${one.name}` : "   not in the map"}`);
    if (!named.length) out.push("no classes");

    // svg carries its meaning in attributes rather than in class names, so an element
    // with no classes at all can still be fully identified by what is written on it
    const attrs = Array.from(el.attributes).filter(one => one.name !== "class");
    if (attrs.length) {
        out.push("");
        for (const one of attrs) {
            // one background-image url is longer than the whole budget used to be, so
            // style is split and every declaration gets its own allowance
            if (one.name === "style") {
                for (const decl of one.value.split(";")) {
                    const text = decl.trim();
                    if (text) out.push(`style  ${cut(text, 200)}`);
                }
            } else {
                out.push(`${one.name}="${cut(one.value, 400)}"`);
            }
        }
    }

    return out;
}

const Native = VencordNative.pluginHelpers.Inspector as PluginNative<typeof import("./native")>;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** a run of files all called div.txt is impossible to tell apart later, so the tag and
 *  the first couple of class tokens go in the name too */
const nameFor = (el: Element) => {
    const named = read(el).filter(one => one.name).map(one => one.name).slice(0, 2);
    const tokens = named.length ? named : Array.from(el.classList).slice(0, 2).map(one => one.split("_")[0]);
    return [el.tagName.toLowerCase(), ...tokens].join("-");
};

const typing = (el: EventTarget | null) => {
    const node = el as HTMLElement | null;
    return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
};

/** the wrapper is what a click reaches; the dot painted on top of it is usually what you
 *  wanted. this lists both, and the parent, so getting to either is one click. */
function Nearby({ el, at }: { el: Element; at?: Point; }) {
    const here = useMemo(() => at ? atPoint(el, at.x, at.y).filter(one => one !== el) : [], [el, at]);
    const up = el.parentElement;
    // a click lands on whatever is on top, which is often a wrapper. without a way down
    // the only element you can reach reliably is the one you already have.
    const down = Array.from(el.children).slice(0, 4);

    if (!here.length && !up && !down.length) return null;

    const jump = (node: Element) => () => show(node, undefined, at);

    return (
        <div className={cl("nearby")}>
            <span className={cl("nearby-label")}>also here</span>
            {up && <button type="button" className={cl("chip")} onClick={jump(up)}>↑ {label(up)}</button>}
            {down.map((node, i) => <button key={`down-${i}`} type="button" className={cl("chip")} onClick={jump(node)}>↓ {label(node)}</button>)}
            {here.map((node, i) => <button key={i} type="button" className={cl("chip")} onClick={jump(node)}>{label(node)}</button>)}
        </div>
    );
}

function Tool({ icon, label, keyName, onClick, active }: { icon: keyof typeof ICONS; label: string; keyName: string; onClick: () => void; active?: boolean; }) {
    return (
        <button type="button" aria-label={label} data-tip={label} aria-pressed={active} className={cl("tool")} onClick={onClick}>
            <Icon name={icon} />
            <kbd className={cl("key", "key-small")}>{keyName}</kbd>
        </button>
    );
}

export interface Pick {
    ref: WeakRef<Element>;
    label: string;
    at: number;
}

export const history: Pick[] = [];
const historyWatchers = new Set<() => void>();
export const onHistory = (fn: () => void) => {
    historyWatchers.add(fn);
    return () => void historyWatchers.delete(fn);
};

let pinned: WeakRef<Element> | null = null;

function Report({ el, other }: { el: Element; other?: Element; }) {
    // themes arrive through an @import from a cdn, and a cross-origin sheet throws on
    // cssRules. fetching them first is the difference between naming the rule that wins
    // and reporting that nine stylesheets could not be read.
    const [warmed, setWarmed] = useState(false);
    const [since, setSince] = useState<string[] | null>(null);
    const [extra, setExtra] = useState<{ title: string; lines: string[]; }[]>([]);
    const [watched, setWatched] = useState<string[] | null>(null);
    const [isPinned, setPinned] = useState(pinned?.deref() === el);

    useEffect(() => {
        let live = true;
        warmRemoteSheets().then(() => live && setWarmed(true));
        Promise.resolve().then(() => Native.previous(nameFor(el))).then(found => live && found && setSince(hashDiff(found, el)), () => { });
        return () => { live = false; };
    }, []);

    const against = other ?? (pinned?.deref() !== el ? pinned?.deref() : undefined);

    const fixed = useMemo(() => [
        { title: "Element", lines: element(el), start: true },
        { title: "Selector", lines: selector(el), start: true },
        { title: "Path", lines: path(el), start: true },
        { title: "Inside", lines: inside(el) },
        { title: "Winning rules", lines: winners(el) },
        { title: "Pseudo elements", lines: pseudo(el) },
        { title: "Variables", lines: vars(el) },
        { title: "Layout", lines: layout(el) },
        { title: "Owners", lines: owners(el) },
        { title: "React", lines: react(el) },
        { title: ":has() rules", lines: hasRules(el) },
        ...(against?.isConnected ? [{ title: "Compared", lines: compare(el, against), start: true }] : [])
    ], [el, against, warmed]);

    const sections = [
        ...fixed,
        ...(since ? [{ title: "Since last dump", lines: since }] : []),
        ...(watched ? [{ title: "Watching", lines: watched.length ? watched : ["waiting for a change"], start: true }] : []),
        ...extra.map(one => ({ ...one, start: true }))
    ];

    const [copied, setCopied] = useState(-1);
    const [status, setStatus] = useState("");
    const [flash, setFlash] = useState("");

    const copy = (n: number) => {
        const one = sections[n];
        if (!one) return;
        navigator.clipboard.writeText(one.lines.join("\n")).then(() => setCopied(n), () => setCopied(-1));
    };

    const everything = () =>
        sections.map(one => `=== ${one.title} ===\n${one.lines.join("\n")}`).join("\n\n");

    /** one paste that answers everything, so the question is never which block to send */
    const copyAll = () => {
        navigator.clipboard.writeText(everything()).then(() => setCopied(-2), () => setCopied(-1));
    };

    /** the clipboard only reaches a person who is here to paste it. a file on disk can be
     *  read by whatever is helping, which is the whole round trip this removes. */
    const saveAll = () => {
        setStatus("saving...");
        Native.save(`${stamp()}-${nameFor(el)}.txt`, everything()).then(
            file => { setStatus(`written to ${file}`); setFlash(file.split(/[\\/]/).pop() ?? file); },
            error => setStatus(`could not write the file: ${error?.message ?? String(error)}`)
        );
    };

    const saveHtml = () => {
        Native.save(`${stamp()}-${nameFor(el)}.html`, exportHtml(el)).then(
            file => setStatus(`html written to ${file}`),
            error => setStatus(`could not write the html: ${error?.message ?? String(error)}`)
        );
    };

    const addNotes = () => {
        const file = Settings.plugins.Inspector.notesFile as string;
        if (!file) return setStatus("set a notes file in Inspector's settings first");
        const lines = ["Element", "Selector", "Path"].flatMap(title => sections.find(one => one.title === title)?.lines ?? []);
        const text = `\n### ${label(el)} (Inspector, ${new Date().toISOString().slice(0, 10)})\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`;
        Promise.resolve().then(() => Native.appendNotes(file, text)).then(
            () => setStatus(`added to ${file}`),
            error => setStatus(`could not add to the notes: ${error?.message ?? String(error)}`)
        );
    };

    const togglePin = () => {
        const now = pinned?.deref() === el;
        pinned = now ? null : new WeakRef(el);
        setReference(el);
        setPinned(!now);
        setStatus(now ? "unpinned" : "pinned. the next pick compares with this one, and alt while picking measures from it");
    };

    const stopWatch = useRef<(() => void) | null>(null);
    const toggleWatch = () => {
        if (stopWatch.current) {
            stopWatch.current();
            stopWatch.current = null;
            setWatched(null);
            return;
        }
        setWatched([]);
        stopWatch.current = watch(el, line => setWatched(lines => [...(lines ?? []), line].slice(-200)));
    };
    useEffect(() => () => stopWatch.current?.(), []);

    const addSection = (title: string, lines: string[]) =>
        setExtra(now => [...now.filter(one => one.title !== title), { title, lines }]);

    const recordNow = () => {
        setStatus("recording for one second...");
        record(el).then(lines => { addSection("Recorded", lines); setStatus(""); });
    };

    const timeIt = () => addSection("Restyle cost", restyleCost(el));

    const compareNext = () => { close(); arm(b => show(el, b)); };
    const pickAnother = () => { close(); arm((a, at) => show(a, undefined, at)); };

    useEffect(() => {
        if (copied < 0) return;
        const clear = setTimeout(() => setCopied(-1), 1500);
        return () => clearTimeout(clear);
    }, [copied]);

    useEffect(() => {
        if (!flash) return;
        const clear = setTimeout(() => setFlash(""), 2000);
        return () => clearTimeout(clear);
    }, [flash]);

    const keys: Record<string, () => void> = {
        KeyS: saveAll, KeyP: togglePin, KeyC: compareNext, KeyA: pickAnother, KeyN: addNotes,
        KeyW: toggleWatch, KeyR: recordNow, KeyT: timeIt, KeyE: saveHtml, Digit0: copyAll
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopImmediatePropagation();
                return close();
            }
            const run = keys[e.code] ?? (/^Digit[1-9]$/.test(e.code) ? () => copy(Number(e.code.slice(5)) - 1) : null);
            if (!run) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            run();
        };

        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [sections]);

    return (
        <>
            <div className={cl("tools")}>
                <Tool icon={copied === -2 ? "check" : "copy"} label="Copy everything" keyName="0" onClick={copyAll} />
                <Tool icon={flash ? "check" : "save"} label="Save to a file" keyName="s" onClick={saveAll} />
                <Tool icon="notes" label="Add to your notes file" keyName="n" onClick={addNotes} />
                <span className={cl("tools-gap")} />
                <Tool icon="pin" label={isPinned ? "Unpin" : "Pin, to compare and measure from"} keyName="p" onClick={togglePin} active={isPinned} />
                <Tool icon="compare" label="Compare with another element" keyName="c" onClick={compareNext} />
                <Tool icon="pick" label="Pick another" keyName="a" onClick={pickAnother} />
                <span className={cl("tools-gap")} />
                <Tool icon="watch" label={watched ? "Stop watching" : "Watch for changes"} keyName="w" onClick={toggleWatch} active={!!watched} />
                <Tool icon="record" label="Record one second" keyName="r" onClick={recordNow} />
                <Tool icon="timer" label="Time a restyle" keyName="t" onClick={timeIt} />
                <Tool icon="html" label="Export as HTML" keyName="e" onClick={saveHtml} />
            </div>

            {(flash || status) && <div className={cl("status")}>{flash ? `saved ${flash}` : status}</div>}

            {sections.slice(0, 2).map((one, i) => (
                <Section key={one.title} {...one} n={i + 1} copied={copied === i} onCopy={() => copy(i)} />
            ))}

            <ExpandableSection initialExpanded={false} renderContent={() => <Try el={el} />}>
                <div className={cl("section-head")}>
                    <kbd className={cl("key")}>·</kbd>
                    <HeadingSecondary className={cl("section-title")}>Try a value</HeadingSecondary>
                </div>
            </ExpandableSection>

            {sections.slice(2).map((one, i) => (
                <Section key={one.title} {...one} n={i + 3} copied={copied === i + 2} onCopy={() => copy(i + 2)} />
            ))}
        </>
    );
}

function Sheet({ el, other, at }: { el: Element; other?: Element; at?: Point; }) {
    const named = read(el).find(one => one.name)?.name;
    return (
        <aside className={cl("sheet")} aria-label="Inspector">
            <header className={cl("sheet-head")}>
                <div className={cl("sheet-title")}>
                    <Text variant="heading-md/semibold">Inspector</Text>
                    <span className={cl("sheet-subtitle")}>{named ? `${el.tagName.toLowerCase()} · ${named}` : el.tagName.toLowerCase()}</span>
                </div>
                <button type="button" className={cl("tool")} aria-label="Close" data-tip="Close" onClick={close}>
                    <Icon name="close" />
                    <kbd className={cl("key", "key-small")}>esc</kbd>
                </button>
            </header>
            <div className={cl("sheet-body")}>
                <Shot el={el} />
                <Nearby el={el} at={at} />
                <Report el={el} other={other} />
            </div>
        </aside>
    );
}

let host: HTMLElement | null = null;
let root: Root | null = null;
let opened = 0;

function render(node: React.ReactNode) {
    if (!host?.isConnected) {
        host = document.createElement("div");
        host.className = cl("host");
        document.body.appendChild(host);
        root = createRoot(host);
    }
    root!.render(node);
}

export function close() {
    root?.render(null);
}

export function destroy() {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
}

export function show(el: Element, other?: Element, at?: Point) {
    history.unshift({ ref: new WeakRef(el), label: label(el), at: Date.now() });
    history.splice(20);
    for (const tell of historyWatchers) tell();
    setReference(pinned?.deref() ?? el);

    render(
        <ErrorBoundary noop>
            <Sheet key={++opened} el={el} other={other} at={at} />
        </ErrorBoundary>
    );
}
