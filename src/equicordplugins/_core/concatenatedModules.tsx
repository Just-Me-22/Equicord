/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IconsDef } from "@equicordplugins/iconViewer/types";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Icon } from "@vencord/discord-types";
import { findModuleId, wreq } from "@webpack";
import { useEffect, useState } from "@webpack/common";

type IconLoader = (path: string) => Promise<Record<string, Icon>>;
type IconMap = Record<string, [id: string, chunks: unknown[]]>;

export let iconsModule: IconsDef = {};

function lazyIcon(name: string, path: string, id: string, load: IconLoader): Icon {
    let real: Icon | undefined;
    let loading: Promise<Icon | undefined> | undefined;
    const ready = () => real ??= wreq.c[id]?.exports?.[name];
    const fetchIcon = () => loading ??= load(path).then(mod => real = mod[name]);

    return function LazyIcon(props) {
        const [Real, setReal] = useState(ready);

        useEffect(() => {
            if (!Real) fetchIcon().then(icon => icon && setReal(() => icon));
        }, []);

        return Real ? <Real {...props} /> : null;
    };
}

export default definePlugin({
    name: "ConcatenatedModules",
    description: "Extract modules that have been concatenated by the bundler",
    authors: [Devs.thororen],
    patches: [
        {
            find: '"./AngleBracketsIcon.web.tsx":[',
            replacement: {
                match: /(\i)\.keys=\(\)=>Object\.keys\((\i)\),\1\.id=/,
                replace: "$self.setIconContext($1,$2),$&"
            }
        }
    ],

    start() {
        const id = findModuleId('"./AngleBracketsIcon.web.tsx":[');
        if (id != null) wreq(id);
    },

    setIconContext(load: IconLoader, map: IconMap) {
        const icons: IconsDef = {};
        for (const [path, [id]] of Object.entries(map)) {
            const name = /^\.\/(\w+)\.web\.tsx$/.exec(path)?.[1];
            if (name) icons[name] = lazyIcon(name, path, id, load);
        }

        iconsModule = icons;

        // incase you dont want to use iconviewer you can do
        // Vencord.Plugins.plugins.ConcatenatedModules.iconsModule instead for icons and viewing paths
        this.iconsModule = icons;
    },
});
