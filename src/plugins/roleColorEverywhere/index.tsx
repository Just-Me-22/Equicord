/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./style.css";

import { definePluginSettings, Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { getCustomColorString } from "@equicordplugins/customUserColors";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, GuildRoleStore, GuildStore } from "@webpack/common";

const useMessageAuthor = findByCodeLazy('"Result cannot be null because the message is not null"');

const settings = definePluginSettings({
    chatMentions: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show role colors in chat mentions (including in the message box)",
        restartNeeded: true
    },
    memberList: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show role colors in member list role headers",
        restartNeeded: true
    },
    voiceUsers: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show role colors in the voice chat user list",
        restartNeeded: true
    },
    reactorsList: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show role colors in the reactors list",
        restartNeeded: true
    },
    pollResults: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show role colors in the poll results",
        restartNeeded: true
    },
    colorChatMessages: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Color chat messages based on the author's role color",
        restartNeeded: true,
    },
    messageSaturation: {
        type: OptionType.SLIDER,
        description: "Intensity of message coloring.",
        markers: makeRange(0, 100, 10),
        default: 30
    },
    gradientChatMessages: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Color chat messages with the author's display name gradient, when they have one. Takes priority over the flat role color above",
        restartNeeded: true
    },
    gradientMentions: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Use the display name gradient for chat mentions (including in the message box)",
        restartNeeded: true
    },
    animateGradients: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Slide the gradients the way the display name does. Turn this off if chat starts feeling heavy"
    },
    gradientSpeed: {
        type: OptionType.SLIDER,
        description: "Seconds for one pass of the gradient.",
        markers: [2, 3, 4, 6, 8, 12],
        default: 4,
        stickToMarkers: false
    },
    gradientSmoothness: {
        type: OptionType.SLIDER,
        description: "Gradient steps per second. Higher is smoother but repaints the text more often; 60 runs it fully smooth.",
        markers: [8, 15, 24, 30, 60],
        default: 24,
        stickToMarkers: false
    }
});

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

// background-clip:text cannot be composited, so every distinct frame is a real text
// repaint for every gradient message on screen. stepping bounds that count; at 60 the
// step boundaries land denser than the display refresh, so hand it to the compositor.
function easing(seconds: number, stepsPerSecond: number) {
    const fps = Math.round(stepsPerSecond);
    if (fps >= 60) return "linear";
    return `steps(${Math.max(1, Math.round(seconds * fps))})`;
}

// keyed by the settings too, so changing them supersedes old entries rather than
// needing invalidation. holds nulls as well: most users have no gradient, and that
// is the path every message render takes
const gradientCache = new Map<string, any>();

export default definePlugin({
    name: "RoleColorEverywhere",
    authors: [Devs.KingFish, Devs.lewisakura, Devs.AutumnVN, Devs.Kyuuhachi, Devs.jamesbt365],
    description: "Adds the top role color anywhere possible",
    tags: ["Roles", "Appearance"],
    settings,

    patches: [
        // Chat Mentions
        {
            find: ".USER_MENTION)",
            replacement: [
                {
                    match: /(?<=user:(\i),guildId:([^,]+?),.{0,100}?children:\i=>\i)\((\i)\)/,
                    replace: "($self.getMentionProps($3,$1?.id,$2))",
                }
            ],
            predicate: () => settings.store.chatMentions || settings.store.gradientMentions
        },
        // Slate
        {
            // Same find as FullUserInChatbox
            find: '"text":"locked"',
            replacement: [
                {
                    match: /let\{id:(\i),guildId:\i,channelId:(\i)[^}]*\}.*?\.\i,{(?=children)/,
                    replace: "$&color:$self.getColorInt($1,$2),style:$self.getMentionStyle($1,$2),"
                }
            ],
            predicate: () => settings.store.chatMentions || settings.store.gradientMentions
        },
        // Member List Role Headers
        {
            find: 'tutorialId:"whos-online',
            replacement: [
                {
                    match: /(#{intl::CHANNEL_MEMBERS_A11Y_LABEL}.+}\):null,).{0,100}?(?:—|\\u2014) ",\i\]\}\)\]/,
                    replace: "$1$self.RoleGroupColor(arguments[0])]"
                },
            ],
            predicate: () => settings.store.memberList
        },
        {
            find: "#{intl::THREAD_BROWSER_PRIVATE}",
            replacement: [
                {
                    match: /children:\[\i," (?:—|\\u2014) ",\i\]/,
                    replace: "children:[$self.RoleGroupColor(arguments[0])]"
                },
            ],
            predicate: () => settings.store.memberList
        },
        // Voice Users
        {
            find: "#{intl::GUEST_NAME_SUFFIX})]",
            replacement: [
                {
                    match: /#{intl::GUEST_NAME_SUFFIX}.{0,50}?"".{0,100}\](?=\}\))(?<=guildId:(\i),.+?user:(\i).+?)/,
                    replace: "$&,style:$self.getColorStyle($2.id,$1),"
                }
            ],
            predicate: () => settings.store.voiceUsers
        },
        // Reaction List
        {
            find: "MessageReactions.render:",
            replacement: {
                match: /tag:"strong",variant:"text-md\/medium"(?<=onContextMenu:.{0,15}\((\i),(\i),\i\).+?)/,
                replace: "$&,style:$self.getColorStyle($2?.id,$1?.channel?.id)"
            },
            predicate: () => settings.store.reactorsList,
        },
        // Poll Results
        {
            find: ",reactionVoteCounts",
            replacement: {
                match: /\.SIZE_32.+?variant:"text-md\/normal",className:\i\.\i,(?="aria-label":)/,
                replace: "$&style:$self.getColorStyle(arguments[0]?.user?.id,arguments[0]?.channel?.id),"
            },
            predicate: () => settings.store.pollResults
        },
        // Messages
        {
            find: ".SEND_FAILED,",
            replacement: {
                match: /(?<=\]:(\i)\.isUnsupported.{0,50}?,)(?=children:\[)/,
                replace: "style:$self.useMessageColorsStyle($1),"
            },
            predicate: () => settings.store.colorChatMessages || settings.store.gradientChatMessages
        }
    ],

    getColorString(userId: string, channelOrGuildId: string) {
        try {
            if (Settings.plugins.CustomUserColors.enabled) {
                const customColor = getCustomColorString(userId, true);
                if (customColor) return customColor;
            }

            const guildId = ChannelStore.getChannel(channelOrGuildId)?.guild_id ?? GuildStore.getGuild(channelOrGuildId)?.id;
            if (guildId == null) return null;

            return GuildMemberStore.getMember(guildId, userId)?.colorString ?? null;
        } catch (e) {
            new Logger("RoleColorEverywhere").error("Failed to get color string", e);
        }

        return null;
    },

    getColorInt(userId: string, channelOrGuildId: string) {
        const colorString = this.getColorString(userId, channelOrGuildId);
        return colorString && parseInt(colorString.slice(1), 16);
    },

    getGradientStyle(userId: string, channelOrGuildId: string) {
        try {
            const guildId = ChannelStore.getChannel(channelOrGuildId)?.guild_id ?? GuildStore.getGuild(channelOrGuildId)?.id;
            if (guildId == null) return null;

            const { animateGradients, gradientSpeed, gradientSmoothness } = settings.store;
            const key = `${guildId}:${userId}:${animateGradients}:${gradientSpeed}:${gradientSmoothness}`;
            if (gradientCache.has(key)) return gradientCache.get(key);

            const member = GuildMemberStore.getMember(guildId, userId) as any;

            // only a gradient *role* on the server. the personal collectible name style is
            // deliberately not a source: a solid role must stay solid even when its owner
            // has a gradient display name
            const role = member?.colorStrings;
            const stops = [role?.primaryColor, role?.secondaryColor, role?.tertiaryColor].filter(Boolean) as string[];

            if (stops.length < 2) {
                gradientCache.set(key, null);
                return null;
            }

            const animate = animateGradients && !REDUCED_MOTION.matches;

            const style = {
                // mirrored, so the image ends on the colour it starts with and tiles seamlessly
                backgroundImage: `linear-gradient(90deg, ${[...stops, ...stops.slice(0, -1).reverse()].join(", ")})`,
                backgroundSize: "200% auto",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                animation: animate ? `rce-gradient ${gradientSpeed}s ${easing(gradientSpeed, gradientSmoothness)} infinite` : undefined
            };

            gradientCache.set(key, style);
            return style;
        } catch (e) {
            new Logger("RoleColorEverywhere").error("Failed to get gradient", e);
        }

        return null;
    },

    getMentionProps(props: any, userId: string, channelOrGuildId: string) {
        const base = { ...props, color: this.getColorInt(userId, channelOrGuildId) };
        if (!settings.store.gradientMentions) return base;

        const gradient = this.getGradientStyle(userId, channelOrGuildId);
        return gradient ? { ...base, style: { ...props?.style, ...gradient } } : base;
    },

    getMentionStyle(userId: string, channelOrGuildId: string) {
        return settings.store.gradientMentions ? this.getGradientStyle(userId, channelOrGuildId) : undefined;
    },

    getColorStyle(userId: string, channelOrGuildId: string) {
        const colorString = this.getColorString(userId, channelOrGuildId);

        return colorString && {
            color: colorString
        };
    },

    useMessageColorsStyle(message: any) {
        try {
            const { messageSaturation, gradientChatMessages } = settings.use(["messageSaturation", "gradientChatMessages"]);
            const author = useMessageAuthor(message);

            // Do not apply role color if the send fails, otherwise it becomes indistinguishable
            if (message.state === "SEND_FAILED") return;

            if (gradientChatMessages) {
                const gradient = this.getGradientStyle(message.author?.id, message.channel_id);
                if (gradient) return gradient;
            }

            if (author.colorString != null && messageSaturation !== 0) {
                const value = `color-mix(in oklab, ${author.colorString} ${messageSaturation}%, var({DEFAULT}))`;

                return {
                    color: value.replace("{DEFAULT}", "--text-default"),
                    "--text-strong": value.replace("{DEFAULT}", "--text-strong"),
                    "--text-muted": value.replace("{DEFAULT}", "--text-muted")
                };
            }
        } catch (e) {
            new Logger("RoleColorEverywhere").error("Failed to get message color", e);
        }

        return null;
    },

    RoleGroupColor: ErrorBoundary.wrap(({ id, count, title, guildId, label }: { id: string; count: number; title: string; guildId: string; label: string; }) => {
        const role = GuildRoleStore.getRole(guildId, id);

        return (
            <span style={{
                color: role?.colorString,
                fontWeight: "unset",
                letterSpacing: ".05em"
            }}>
                {title ?? label} &mdash; {count}
            </span>
        );
    }, { noop: true })
});
