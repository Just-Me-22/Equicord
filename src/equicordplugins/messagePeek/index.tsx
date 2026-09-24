/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { DecoratorProps } from "@api/MemberListDecorators";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import { startWatching, stopWatching } from "./hooks";
import { Decorator, PrivateChannelProps, SubText } from "./Preview";
import { clearSearch, useFilteredIds, withSearch } from "./Search";
import { settings } from "./settings";

export default definePlugin({
    name: "MessagePeek",
    description: "Shows the last message preview and timestamp in the Direct Messages list.",
    dependencies: ["MemberListDecoratorsAPI"],
    tags: ["Appearance", "Chat"],
    authors: [Devs.prism, EquicordDevs.justjxke],
    settings,
    patches: [
        {
            find: "PrivateChannel.renderAvatar",
            replacement: {
                match: /,subText:\i\.isSystemDM\(\).{0,700}:null,(?=name:)/,
                replace: ",subText:$self.getSubText(arguments[0]),"
            }
        },
        {
            find: '"dm-quick-launcher"===',
            replacement: [
                {
                    match: /(?<=\i=)\(0,\i\.\i\)\(\[[^\]]+\],\(\)=>\{let \i=\i\.\i\.getPrivateChannelIds\(\);return[^;]+?\}\)/,
                    replace: "$self.useFilteredIds($&)"
                },
                {
                    match: /\{\.\.\.(\i),(?=density:\i,channels:\i,)/,
                    replace: "{...$1,children:$self.withSearch($1.children),"
                },
                {
                    match: /(?<=else \i=)"compact"===\i\?40:"default"===\i\?44:50/,
                    replace: "$self.rowHeight($&)"
                }
            ]
        }
    ],

    start() {
        startWatching();
    },

    stop() {
        stopWatching();
        clearSearch();
    },

    useFilteredIds,
    withSearch,

    rowHeight(height: number) {
        return settings.store.previewLines === "2" ? height + 16 : height;
    },

    renderMemberListDecorator({ channel }: DecoratorProps) {
        return channel ? <Decorator channel={channel} /> : null;
    },

    getSubText(props: PrivateChannelProps) {
        return <SubText {...props} />;
    }
});
