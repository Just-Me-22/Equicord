/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ExpandableSection } from "@components/ExpandableCard";
import { HeadingSecondary } from "@components/Heading";
import { Button, Modal, openModal, Text, TextInput, useEffect, useRef, useState } from "@webpack/common";

import { read } from "./classMap";
import { thumbnail } from "./picker";
import { layout, path, pseudo, selector, vars, winners } from "./rules";

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

function Section({ title, lines, start }: { title: string; lines: string[]; start?: boolean; }) {
    const [copied, setCopied] = useState(false);

    return (
        <ExpandableSection
            initialExpanded={start === true}
            renderContent={() => <Output lines={lines} />}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexGrow: 1 }}>
                <HeadingSecondary style={{ margin: 0 }}>{title}</HeadingSecondary>
                <Text variant="text-xs/normal" color="text-muted">{lines.length}</Text>
                <Button
                    size={Button.Sizes.MIN}
                    look={Button.Looks.LINK}
                    color={Button.Colors.PRIMARY}
                    style={{ marginLeft: "auto", padding: "2px 10px" }}
                    onClick={e => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(lines.join("\n"));
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    }}
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

function element(el: Element): string[] {
    const named = read(el);
    const out = [el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "")];
    for (const one of named) out.push(`.${one.token}${one.name ? `   is ${one.name}` : "   not in the map"}`);
    return named.length ? out : [...out, "no classes"];
}

export function show(el: Element) {
    const named = read(el).find(one => one.name)?.name;

    openModal(props => (
        <Modal
            {...props}
            size="lg"
            title="Inspector"
            subtitle={named ? `${el.tagName.toLowerCase()}, ${named}` : el.tagName.toLowerCase()}
        >
            <Shot el={el} />
            <Section title="Element" lines={element(el)} start />
            <Section title="Selector" lines={selector(el)} start />
            <ExpandableSection initialExpanded={false} renderContent={() => <Try el={el} />}>
                <HeadingSecondary style={{ margin: 0 }}>Try a value</HeadingSecondary>
            </ExpandableSection>
            <Section title="Path" lines={path(el)} />
            <Section title="Winning rules" lines={winners(el)} />
            <Section title="Pseudo elements" lines={pseudo(el)} />
            <Section title="Variables" lines={vars(el)} />
            <Section title="Layout" lines={layout(el)} />
        </Modal>
    ));
}
