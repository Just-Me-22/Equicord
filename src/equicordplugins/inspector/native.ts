/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { IpcMainInvokeEvent } from "electron";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/** next to settings and themes rather than in Documents: it is scratch output, and it
 *  belongs with the rest of the client's state where it can be cleared in one go. */
const REPORTS = join(DATA_DIR, "inspector");

/** enough to stop a class name with a slash in it writing outside the folder */
const safe = (name: string) => name.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80);

/** the folder is a scratchpad, not an archive. without a cap a long session leaves
 *  hundreds of files and the one you want is impossible to spot by date alone. */
function trim(keep: number) {
    const files = readdirSync(REPORTS)
        .filter(one => one.endsWith(".txt"))
        .sort();

    for (const old of files.slice(0, Math.max(0, files.length - keep))) {
        try {
            rmSync(join(REPORTS, old));
        } catch {
            // a file being read right now is not worth failing the write over
        }
    }
}

export function save(_: IpcMainInvokeEvent, name: string, text: string): string {
    mkdirSync(REPORTS, { recursive: true });
    const file = join(REPORTS, safe(name));
    writeFileSync(file, text, "utf8");
    trim(40);
    return file;
}

export function folder(_: IpcMainInvokeEvent): string {
    return REPORTS;
}
