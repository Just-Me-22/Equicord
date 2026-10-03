/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getIntlMessage } from "@utils/discord";
import { ChannelStore, UserStore } from "@webpack/common";

import { BasicChannelTabsProps } from "./types";

export const specialPageLabels: Record<string, () => string> = {
    "__quests__": () => "Quests",
    "__message-requests__": () => "Message Requests",
    "__friends__": () => getIntlMessage("FRIENDS"),
    "__shop__": () => "Shop",
    "__library__": () => "Library",
    "__discovery__": () => "Discovery",
    "__nitro__": () => "Nitro",
    "__icymi__": () => "ICYMI",
    "__activity__": () => "Activity"
};

export function tabTitle(tab: BasicChannelTabsProps & { label?: string; }): string {
    if (tab.label) return tab.label;

    const page = specialPageLabels[tab.channelId];
    if (page) return page();

    const channel = ChannelStore.getChannel(tab.channelId);
    if (channel?.name) return channel.name;

    const people = (channel?.recipients ?? []).map(id => {
        const user = UserStore.getUser(id);
        return user?.globalName || user?.username;
    }).filter(Boolean);
    if (people.length) return people.join(", ");

    return getIntlMessage(!tab.guildId || tab.guildId === "@me" ? "FRIENDS" : "UNKNOWN_CHANNEL");
}
