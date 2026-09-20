/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ExpandableSection } from "@components/ExpandableCard";
import { HeadingSecondary } from "@components/Heading";
import { PluginNative } from "@utils/types";
import { Button, Modal, openModal, Text, TextInput, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { read } from "./classMap";
import { arm, Point, thumbnail } from "./picker";
import { atPoint, compare, inside, label, layout, path, pseudo, selector, vars, winners } from "./rules";

function Output({ lines }: { lines: string[]; }) {
    return (
        <pre style={{
            margin: 0,
            padding: "12px 14px",
            overflowX: "auto",
            background: "var(--background-tertiary)",
            borderRadius: 6,
            fontFamily: "var(--font-code)",
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--text-default)"
        }}>
            {lines.join("\n")}
        </pre>
    );
}

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
            renderContent={() => <Output lines={lines} />}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexGrow: 1 }}>
                <span
                    onClick={take}
                    title={`Copy, or press ${n}`}
                    style={{
                        minWidth: 20,
                        padding: "1px 0",
                        textAlign: "center",
                        borderRadius: 5,
                        cursor: "pointer",
                        fontFamily: "var(--font-code)",
                        fontSize: 12,
                        fontWeight: 600,
                        background: copied ? "var(--brand-500)" : "var(--background-modifier-selected)",
                        color: copied ? "var(--white)" : "var(--text-muted)"
                    }}
                >
                    {n}
                </span>
                <HeadingSecondary style={{ margin: 0 }}>{title}</HeadingSecondary>
                <Text variant="text-xs/normal" color="text-muted">{lines.length}</Text>
                <Button
                    size={Button.Sizes.MIN}
                    look={Button.Looks.LINK}
                    color={Button.Colors.PRIMARY}
                    style={{ marginLeft: "auto", padding: "2px 10px" }}
                    onClick={take}
                >
                    {copied ? "Copied" : "Copy"}
                </Button>
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
    const [prop, setProp] = useState("");
    const [value, setValue] = useState("");

    const rule = sel && prop && value ? `${sel} {
    ${prop}: ${value};
}` : "";

    useEffect(() => {
        const tag = document.getElementById(TRY) ?? document.head.appendChild(
            Object.assign(document.createElement("style"), { id: TRY })
        );
        tag.textContent = rule;
        return () => tag.remove();
    }, [rule]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <TextInput value={sel} onChange={setSel} placeholder="#app-mount .thing" />
            <div style={{ display: "flex", gap: 8 }}>
                <TextInput value={prop} onChange={setProp} placeholder="background-color" style={{ flex: 1 }} />
                <TextInput value={value} onChange={setValue} placeholder="red" style={{ flex: 1 }} />
            </div>
            {rule && <Output lines={rule.split("\n")} />}
            <Text variant="text-xs/normal" color="text-muted">
                Applied live while this is open. Closing the modal takes it back off.
            </Text>
        </div>
    );
}

function Shot({ el }: { el: Element; }) {
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (box.current) thumbnail(el, box.current, 860, 190);
    }, [el]);

    return (
        <div style={{
            display: "flex", justifyContent: "center", padding: 12, marginBottom: 16,
            background: "var(--background-tertiary)", borderRadius: 8
        }}>
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

const nameFor = (el: Element) => read(el).find(one => one.name)?.name ?? el.tagName.toLowerCase();

const typing = (el: EventTarget | null) => {
    const node = el as HTMLElement | null;
    return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
};

/** the wrapper is what a click reaches; the dot painted on top of it is usually what you
 *  wanted. this lists both, and the parent, so getting to either is one click. */
function Nearby({ el, at, close }: { el: Element; at?: Point; close: () => void; }) {
    const here = useMemo(() => at ? atPoint(el, at.x, at.y).filter(one => one !== el) : [], [el, at]);
    const up = el.parentElement;

    if (!here.length && !up) return null;

    const jump = (node: Element) => () => { close(); show(node, undefined, at); };

    return (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <Text variant="text-xs/normal" color="text-muted">also here</Text>
            {up && (
                <Button size={Button.Sizes.MIN} look={Button.Looks.LINK} color={Button.Colors.PRIMARY} onClick={jump(up)}>
                    ↑ {label(up)}
                </Button>
            )}
            {here.map((node, i) => (
                <Button
                    key={i}
                    size={Button.Sizes.MIN}
                    look={Button.Looks.LINK}
                    color={Button.Colors.PRIMARY}
                    onClick={jump(node)}
                >
                    {label(node)}
                </Button>
            ))}
        </div>
    );
}

/** every section carries the same Copy button, so the one you meant and the one next to
 *  it are a few pixels apart and the wrong block reaches the clipboard. the number is
 *  both the label and the key that copies it. */
function Report({ el, other, close }: { el: Element; other?: Element; close: () => void; }) {
    const sections = useMemo(() => [
        { title: "Element", lines: element(el), start: true },
        { title: "Selector", lines: selector(el), start: true },
        { title: "Path", lines: path(el), start: true },
        { title: "Inside", lines: inside(el) },
        { title: "Winning rules", lines: winners(el) },
        { title: "Pseudo elements", lines: pseudo(el) },
        { title: "Variables", lines: vars(el) },
        { title: "Layout", lines: layout(el) },
        ...(other ? [{ title: "Compared", lines: compare(el, other), start: true }] : [])
    ], [el, other]);

    const [copied, setCopied] = useState(-1);

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

    const [saved, setSaved] = useState("");

    /** the clipboard only reaches a person who is here to paste it. a file on disk can be
     *  read by whatever is helping, which is the whole round trip this removes. */
    const saveAll = () => {
        setSaved("saving...");
        Native.save(`${stamp()}-${nameFor(el)}.txt`, everything()).then(
            file => setSaved(file),
            error => setSaved(`could not write the file: ${error?.message ?? String(error)}`)
        );
    };

    const wrote = saved.includes("\\") || saved.includes("/");

    useEffect(() => {
        if (copied < 0) return;
        const clear = setTimeout(() => setCopied(-1), 1500);
        return () => clearTimeout(clear);
    }, [copied]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
            if (!/^Digit[0-9]$/.test(e.code) && e.code !== "KeyS") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.code === "KeyS") saveAll();
            else if (e.code === "Digit0") copyAll();
            else copy(Number(e.code.slice(5)) - 1);
        };

        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [sections]);

    return (
        <>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={copyAll}>
                    {copied === -2 ? "Copied everything" : "Copy all  (0)"}
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    onClick={() => { close(); arm(b => show(el, b)); }}
                >
                    {other ? "Compare with something else" : "Compare with…"}
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    onClick={() => { close(); arm((a, at) => show(a, undefined, at)); }}
                >
                    Pick another
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={wrote ? Button.Colors.GREEN : Button.Colors.BRAND}
                    onClick={saveAll}
                >
                    {wrote ? "Saved ✓" : "Save to file  (s)"}
                </Button>
            </div>

            <Text variant="text-xs/normal" color="text-muted" style={{ marginBottom: 12, wordBreak: "break-all" }}>
                {saved
                    ? (wrote ? `written to ${saved}` : saved)
                    : "press a number to copy that section, 0 for all of them, s to write the lot to a file"}
            </Text>

            {sections.slice(0, 2).map((one, i) => (
                <Section key={one.title} {...one} n={i + 1} copied={copied === i} onCopy={() => copy(i)} />
            ))}

            <ExpandableSection initialExpanded={false} renderContent={() => <Try el={el} />}>
                <HeadingSecondary style={{ margin: 0 }}>Try a value</HeadingSecondary>
            </ExpandableSection>

            {sections.slice(2).map((one, i) => (
                <Section key={one.title} {...one} n={i + 3} copied={copied === i + 2} onCopy={() => copy(i + 2)} />
            ))}
        </>
    );
}

export function show(el: Element, other?: Element, at?: Point) {
    const named = read(el).find(one => one.name)?.name;

    openModal(props => (
        <Modal
            {...props}
            size="lg"
            title="Inspector"
            subtitle={named ? `${el.tagName.toLowerCase()}, ${named}` : el.tagName.toLowerCase()}
        >
            <Shot el={el} />
            <Nearby el={el} at={at} close={props.onClose} />
            <Report el={el} other={other} close={props.onClose} />
        </Modal>
    ));
}
