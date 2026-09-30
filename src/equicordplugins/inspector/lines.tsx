/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { React, Toasts } from "@webpack/common";

export const cl = classNameFactory("vc-inspector-");

const TOKENS = /(\[(?:clips|stacking context|scrolls(?:, virtual list)?|CONTAINING BLOCK)\])|(!important)|(\((\d+),(\d+),(\d+)\))|(#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklab|oklch|color-mix)\((?:[^()]|\([^()]*\))*\))/g;

function sourceKind(text: string): string {
    if (text.includes("vencord-custom-css")) return "quickcss";
    if (text.includes("INLINE")) return "inline";
    if (text.includes("(fetched)") || text.includes("vencord-themes") || text.includes(".theme.css")) return "theme";
    if (/\.css\b/.test(text) && /^[0-9a-f.]+\.css/.test(text.trim().split(/\s/)[0])) return "discord";
    return "plugin";
}

const SOURCE_LABEL: Record<string, string> = { quickcss: "QuickCSS", inline: "inline", theme: "theme", discord: "Discord", plugin: "plugin" };

function Rich({ text }: { text: string; }) {
    const parts: React.ReactNode[] = [];
    let at = 0;
    for (const match of text.matchAll(TOKENS)) {
        const start = match.index!;
        if (start > at) parts.push(text.slice(at, start));
        const [whole, tag, important, spec, a, b, c, colour] = match;
        if (tag) parts.push(<span key={start} className={cl("tag")}>{tag.slice(1, -1)}</span>);
        else if (important) parts.push(<span key={start} className={cl("tag", "tag-hot")}>!important</span>);
        else if (spec) parts.push(
            <span key={start} className={cl("spec")} title="ids, classes, elements">
                <span>{a}</span><span>{b}</span><span>{c}</span>
            </span>
        );
        else if (colour) parts.push(
            <span key={start} className={cl("colour")}>
                <span className={cl("swatch")} style={{ background: colour }} />{colour}
            </span>
        );
        else parts.push(whole);
        at = start + whole.length;
    }
    if (at < text.length) parts.push(text.slice(at));
    return <>{parts}</>;
}

function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(
        () => Toasts.show({ message: `Copied ${what}`, id: Toasts.genId(), type: Toasts.Type.SUCCESS }),
        () => Toasts.show({ message: "Could not copy", id: Toasts.genId(), type: Toasts.Type.FAILURE })
    );
}

function Line({ text, section }: { text: string; section: string; }) {
    const indent = text.length - text.trimStart().length;
    const body = text.trimStart();

    if (section === "Path" && /^\s*[a-z]+[.\w-]*\s{3}\d+x\d+/i.test(text)) {
        const depth = Math.floor(indent / 2);
        return (
            <div className={cl("line", "tree")} style={{ "--depth": depth } as React.CSSProperties}>
                <Rich text={body} />
            </div>
        );
    }

    if (section === "Element" && /^\.[\w-]+/.test(text)) {
        const token = body.split(/\s/)[0].slice(1);
        const stem = token.replace(/[0-9a-f]{5,6}$/, "");
        return (
            <div
                className={cl("line", "clickable")}
                title={`Click to copy [class*="${stem}"]`}
                onClick={() => copy(`[class*="${stem}"]`, `[class*="${stem}"]`)}
            >
                <Rich text={text} />
            </div>
        );
    }

    let kind = "";
    if (/^\s+(beat|TIE )\s/.test(text)) kind = text.includes("TIE") ? "tie" : "lost";
    else if (/^\s+won by\s/.test(text)) kind = "won";
    else if (section === "Winning rules" && /^[a-z-]+\s{2,}/.test(text)) kind = "prop";

    if (/^\s+from\s{2,}/.test(text)) {
        const where = body.replace(/^from\s+/, "");
        const source = sourceKind(where);
        return (
            <div className={cl("line")}>
                {" ".repeat(indent)}from    <span className={cl("source", `source-${source}`)}>{SOURCE_LABEL[source]}</span> <Rich text={where} />
            </div>
        );
    }

    return (
        <div className={cl("line", kind && `line-${kind}`)}>
            <Rich text={text} />
        </div>
    );
}

export function Lines({ lines, section }: { lines: string[]; section: string; }) {
    return (
        <div className={cl("lines")}>
            {lines.flatMap(line => line.split("\n")).map((line, i) => line ? <Line key={i} text={line} section={section} /> : <div key={i} className={cl("line-gap")} />)}
        </div>
    );
}
