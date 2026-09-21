/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { PaintbrushIcon } from "@components/Icons";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, TextInput, Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { build, current, read, search } from "./classMap";
import { show } from "./panel";
import { arm, clear, disarm, outline, thumbnail } from "./picker";

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
    Toasts.show({ message: "Click an element, or press escape.", id: Toasts.genId(), type: Toasts.Type.MESSAGE });
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
        return () => void watching.delete(update);
    }, [update]);

    useEffect(() => {
        if (held && shot.current) thumbnail(held, shot.current, 400, 140);
    });

    if (!held) {
        return <Forms.FormText>Press ctrl+alt+i, then click anything in Discord.</Forms.FormText>;
    }

    const named = read(held);
    return (
        <>
            <div ref={shot} style={{ margin: "8px 0" }} />
            <Forms.FormText style={mono}>
                {held.tagName.toLowerCase()}
                {named.length ? "" : "  (no classes)"}
            </Forms.FormText>
            {named.map(one => (
                <Forms.FormText key={one.token} style={mono}>
                    .{one.token}{one.name ? `   is ${one.name}` : "   not in the map"}
                </Forms.FormText>
            ))}
        </>
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
            <Forms.FormText>
                {map.classes} classes across {map.modules} loaded modules, read in {Math.round(map.ms)}ms.
            </Forms.FormText>

            <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
                <TextInput value={query} onChange={setQuery} placeholder="mentioned" style={{ flex: 1 }} />
                <Button size={Button.Sizes.SMALL} onClick={() => { build(); setBuilt(n => n + 1); }}>
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
                    <Forms.FormText style={mono}>
                        {hit.name} &rarr; {hit.tokens.join("  ")}
                        {hit.found.length ? `   ${hit.found.length} on screen` : ""}
                    </Forms.FormText>
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

    start() {
        document.addEventListener("keydown", onKey, true);
        addChannelToolbarButton("vc-inspector", () => <Trigger />);
    },

    stop() {
        document.removeEventListener("keydown", onKey, true);
        removeChannelToolbarButton("vc-inspector");
        disarm();
    }
});
