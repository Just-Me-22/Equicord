/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { PaintbrushIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, TextInput, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { build, current, read, search } from "./classMap";
import { destroy, history, onHistory, show } from "./panel";
import { arm, clear, disarm, outline, thumbnail } from "./picker";
import managedStyle from "./style.css?managed";

const mono = { fontFamily: "var(--font-code)", fontSize: 12 } as const;

let held: Element | null = null;
const watching = new Set<() => void>();

function hold(el: Element | null) {
    held = el;
    for (const tell of watching) tell();
}

function start() {
    arm((el, at) => {
        hold(el);
        show(el, undefined, at);
    });
    showToast({ text: "Click an element, or press escape." });
}

function Trigger() {
    return <HeaderBarButton tooltip="Inspect an element" icon={PaintbrushIcon} onClick={start} />;
}

function onKey(e: KeyboardEvent) {
    if (!e.ctrlKey || !e.altKey || e.code !== "KeyI") return;
    e.preventDefault();
    start();
}

function Picked() {
    const update = useForceUpdater();
    const shot = useRef<HTMLDivElement>(null);

    useEffect(() => {
        watching.add(update);
        const off = onHistory(update);
        return () => {
            watching.delete(update);
            off();
        };
    }, [update]);

    useEffect(() => {
        if (held && shot.current) thumbnail(held, shot.current, 400, 140);
    });

    if (!held) {
        return <Paragraph>Press ctrl+alt+i, then click anything in Discord.</Paragraph>;
    }

    const named = read(held);
    return (
        <>
            <div ref={shot} style={{ margin: "8px 0" }} />
            <Paragraph style={mono}>
                {held.tagName.toLowerCase()}
                {named.length ? "" : "  (no classes)"}
            </Paragraph>
            {named.map(one => (
                <Paragraph key={one.token} style={mono}>
                    .{one.token}{one.name ? `   is ${one.name}` : "   not in the map"}
                </Paragraph>
            ))}
            <History />
        </>
    );
}

function History() {
    if (history.length < 2) return null;
    return (
        <div className="vc-inspector-history">
            <Paragraph>Recent picks</Paragraph>
            {history.map((one, i) => {
                const el = one.ref.deref();
                const live = !!el?.isConnected;
                return (
                    <button
                        key={`${one.at}-${i}`}
                        type="button"
                        className="vc-inspector-history-row"
                        disabled={!live}
                        title={live ? "Open this pick again" : "No longer on screen"}
                        onClick={() => el && show(el)}
                    >
                        <span>{one.label}</span>
                        <span>{new Date(one.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    </button>
                );
            })}
        </div>
    );
}

function Lookup() {
    const [query, setQuery] = useState("");
    const [built, setBuilt] = useState(0);

    const map = useMemo(current, [built]);
    const hits = useMemo(
        () => search(query, 15).map(hit => ({
            ...hit,
            found: hit.tokens.flatMap(token => Array.from(document.getElementsByClassName(token)))
        })),
        [query, built]
    );

    return (
        <>
            <Paragraph>
                {map.classes} classes across {map.modules} loaded modules, read in {Math.round(map.ms)}ms.
            </Paragraph>

            <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
                <TextInput value={query} onChange={setQuery} placeholder="mentioned" style={{ flex: 1 }} />
                <Button size="small" onClick={() => { build(); setBuilt(n => n + 1); }}>
                    Rescan
                </Button>
            </div>

            {hits.map(hit => (
                <div
                    key={hit.name}
                    style={{ padding: "2px 0", cursor: hit.found.length ? "pointer" : "default" }}
                    onMouseEnter={() => outline(hit.found)}
                    onMouseLeave={clear}
                    onClick={() => {
                        const first = hit.found[0];
                        if (!first) return;
                        first.scrollIntoView({ block: "center" });
                        show(first);
                    }}
                >
                    <Paragraph style={mono}>
                        {hit.name} &rarr; {hit.tokens.join("  ")}
                        {hit.found.length ? `   ${hit.found.length} on screen` : ""}
                    </Paragraph>
                </div>
            ))}
        </>
    );
}

const settings = definePluginSettings({
    picked: {
        type: OptionType.COMPONENT,
        description: "The last element you picked.",
        component: () => <ErrorBoundary noop><Picked /></ErrorBoundary>
    },
    lookup: {
        type: OptionType.COMPONENT,
        description: "Find the current class for a name.",
        component: () => <ErrorBoundary noop><Lookup /></ErrorBoundary>
    },
    notesFile: {
        type: OptionType.STRING,
        description: "A .md file that Add to notes appends to, such as your selectors notes.",
        default: ""
    },
    fullCascade: {
        type: OptionType.BOOLEAN,
        description: "List every rule that lost, instead of the first four.",
        default: false
    }
});

export default definePlugin({
    name: "Inspector",
    description: "Reads Discord's class names out of webpack, so a selector can be looked up by name instead of by hash.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    dependencies: ["HeaderBarAPI"],
    settings,
    managedStyle,

    start() {
        document.addEventListener("keydown", onKey, true);
        addChannelToolbarButton("vc-inspector", () => <Trigger />);
    },

    stop() {
        document.removeEventListener("keydown", onKey, true);
        removeChannelToolbarButton("vc-inspector");
        disarm();
        destroy();
    }
});
