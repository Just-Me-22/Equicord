/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { CloudDownloadIcon } from "@components/Icons";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { pluralize } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, showToast, Toasts } from "@webpack/common";

import { hasMedia, itemsOf } from "./media";

const logger = new Logger("DownloadAllAttachments");

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };

const settings = definePluginSettings({
    downloadAllFileTypes: {
        type: OptionType.BOOLEAN,
        description: "Also download non-media attachments. Only enable this if you trust what people send you.",
        default: false
    }
});

async function downloadAll(message: Message) {
    const items = await itemsOf(message, settings.store.downloadAllFileTypes);
    showToast(`Downloading ${pluralize(items.length, "file")}...`, Toasts.Type.MESSAGE);
    const usedNames = new Map<string, number>();

    function uniqueName(original: string): string {
        const count = usedNames.get(original) ?? 0;
        usedNames.set(original, count + 1);
        if (count === 0) return original;
        const dot = original.lastIndexOf(".");
        return dot === -1
            ? `${original}_${count}`
            : `${original.slice(0, dot)}_${count}${original.slice(dot)}`;
    }

    const results = await Promise.allSettled(items.map(async item => {
        const blob = await item.load();
        const extension = EXTENSIONS[blob.type.split(";")[0]];
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = uniqueName(/\.\w{2,4}$/.test(item.name) || !extension ? item.name : `${item.name}.${extension}`);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }));

    const failed = results.filter(r => {
        if (r.status === "rejected") {
            logger.warn("Failed to download file:", r.reason);
            return true;
        }
        return false;
    }).length;

    const succeeded = items.length - failed;

    if (failed === 0)
        showToast(`Downloaded ${pluralize(succeeded, "file")}.`, Toasts.Type.SUCCESS);
    else
        showToast(`Downloaded ${succeeded} of ${items.length} files. ${failed} failed.`, Toasts.Type.FAILURE);
}

export default definePlugin({
    name: "DownloadAllAttachments",
    description: "Adds a popover button to download every file, GIF, sticker, emoji and linked picture in a message at once.",
    tags: ["Utility", "Chat"],
    authors: [EquicordDevs.dhopcs],
    dependencies: ["MessagePopoverAPI"],
    settings,
    messagePopoverButton: {
        icon: CloudDownloadIcon,
        render(message: Message) {
            if (!hasMedia(message)) return null;
            return {
                label: "Download All Attachments",
                icon: CloudDownloadIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: () => downloadAll(message)
            };
        }
    }
});
