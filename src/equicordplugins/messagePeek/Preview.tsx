/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import betterActivities from "@equicordplugins/betterActivities";
import showMeYourName from "@plugins/showMeYourName";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { Activity, ApplicationStream, Channel, Message, OnlineStatus, User } from "@vencord/discord-types";
import { findByCodeLazy, findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { CallStore, DraftStore, DraftType, ExperimentStore, IconUtils, NavigationRouter, Parser, ReadStateStore, RelationshipStore, SelectedChannelStore, SnowflakeUtils, StreamerModeStore, TypingStore, UserGuildSettingsStore, UserStore, useStateFromStores } from "@webpack/common";

import { Actions } from "./Actions";
import { formatRelativeTime, formatTimestamp, getMessageContent, Icons, isStale, matchesKeyword, plainText } from "./content";
import { useLastMessage, useMinute } from "./hooks";
import { settings } from "./settings";

const cl = classNameFactory("vc-message-peek-");

const PrivateChannelClasses = findCssClassesLazy("subtext", "channel", "interactive");
const ActivityClasses = findCssClassesLazy("textWithIconContainer", "icon", "truncated", "container", "textXs");

const hasRelevantActivity: (props: ActivityCheckProps) => boolean = findByCodeLazy(".OFFLINE||", ".INVISIBLE)return!1");
const ActivityText: React.ComponentType<ActivityTextProps> = findComponentByCodeLazy('"ActivityStatus"');

const ONE_HOUR_MS = 60 * 60 * 1000;

interface ActivityCheckProps {
    activities: Activity[] | null;
    status: OnlineStatus;
    applicationStream: ApplicationStream | null;
    voiceChannel: Channel | null;
}

interface ActivityTextProps {
    user: User;
    activities: Activity[] | null;
    applicationStream: ApplicationStream | null;
    voiceChannel: Channel | null;
}

export interface PrivateChannelProps extends ActivityCheckProps {
    channel: Channel;
    user: User;
}

function getActivityIcons(activities: Activity[] | null, user: User): React.ReactNode {
    if (!activities?.length || !isPluginEnabled(betterActivities.name)) return null;

    return betterActivities.patchActivityList({
        activities,
        user,
        hideTooltip: false
    });
}

function displayName(userId: string) {
    const user = UserStore.getUser(userId);
    return RelationshipStore.getNickname(userId) || user?.globalName || user?.username || "Someone";
}

function authorNameOf(message: Message, smynName: string | null) {
    if (message.author.id === UserStore.getCurrentUser()?.id) return "You";
    return smynName || RelationshipStore.getNickname(message.author.id) || message.author.globalName || message.author.username;
}

function useTyping(channelId: string) {
    return useStateFromStores([TypingStore], () => {
        if (!settings.store.typingIndicator) return "";
        const me = UserStore.getCurrentUser()?.id;
        return Object.keys(TypingStore.getTypingUsers(channelId)).filter(id => id !== me).join();
    }, [channelId]);
}

function useDraft(channelId: string) {
    return useStateFromStores([DraftStore, SelectedChannelStore], () => {
        if (!settings.store.drafts || SelectedChannelStore.getChannelId() === channelId) return "";
        return DraftStore.getDraft(channelId, DraftType.ChannelMessage)?.trim() ?? "";
    }, [channelId]);
}

function useCallStart(channelId: string) {
    return useStateFromStores([CallStore], () => {
        if (!settings.store.callIndicator || !CallStore.isCallActive(channelId)) return 0;
        const messageId = CallStore.getMessageId(channelId);
        return messageId ? SnowflakeUtils.extractTimestamp(messageId) : -1;
    }, [channelId]);
}

function useUnread(channelId: string) {
    return useStateFromStores([ReadStateStore], () => ({
        unread: ReadStateStore.hasUnread(channelId),
        count: Math.max(ReadStateStore.getUnreadCount(channelId), ReadStateStore.getMentionCount(channelId))
    }), [channelId], (a, b) => a.unread === b.unread && a.count === b.count);
}

function MessageLine({ channel, user, message }: { channel: Channel; user: User | null | undefined; message: Message; }) {
    const { unread, count } = useUnread(channel.id);
    const smynName = isPluginEnabled(showMeYourName.name)
        ? showMeYourName.getTypingMemberListProfilesReactionsVoiceNameText({ user: user ?? message.author, type: "membersList" })
        : null;

    const content = getMessageContent(message);
    if (!content) return null;

    const { senderAvatars, boldUnread, unreadCount, fullTextTooltip, jumpToMessage, blurPreviews } = settings.store;
    const authorName = authorNameOf(message, smynName);
    const raw = plainText(message);
    const Icon = content.icon ? Icons[content.icon] : null;

    return (
        <div
            className={classes(
                ActivityClasses.container,
                ActivityClasses.textXs,
                cl("preview", {
                    unread: boldUnread && unread,
                    keyword: matchesKeyword(raw),
                    stale: isStale(SnowflakeUtils.extractTimestamp(message.id)),
                    blurred: blurPreviews
                })
            )}
            title={fullTextTooltip ? `${authorName}: ${raw}` : undefined}
            onClick={jumpToMessage ? e => {
                e.preventDefault();
                e.stopPropagation();
                NavigationRouter.transitionTo(`/channels/@me/${channel.id}/${message.id}`);
            } : undefined}
        >
            {senderAvatars && <img className={cl("avatar")} src={IconUtils.getUserAvatarURL(message.author, false, 16)} alt="" />}
            <span className={ActivityClasses.truncated}>{authorName}: {content.text}</span>
            {Icon && (
                <span className={cl("icon")}>
                    <Icon size="xxs" className={ActivityClasses.icon} />
                </span>
            )}
            {unreadCount && count > 0 && <span className={cl("count")}>{count}</span>}
        </div>
    );
}

function StatusLine({ children, className }: { children: React.ReactNode; className?: string; }) {
    return <div className={classes(ActivityClasses.container, ActivityClasses.textXs, cl("preview"), className)}>
        <span className={ActivityClasses.truncated}>{children}</span>
    </div>;
}

function showsActivity(message: Message | undefined) {
    switch (settings.store.activityRule) {
        case "message": return !message;
        case "activity": return true;
        default: return !message || Date.now() - SnowflakeUtils.extractTimestamp(message.id) > ONE_HOUR_MS;
    }
}

function previewOf({ channel, user }: PrivateChannelProps, message: Message | undefined, typing: string, draft: string, callStart: number) {
    if (callStart) return <StatusLine className={cl("call")}>{callStart > 0 ? `In a call, ${formatRelativeTime(callStart)}` : "In a call"}</StatusLine>;

    if (typing) {
        const ids = typing.split(",");
        return <StatusLine className={cl("typing")}>
            {ids.length === 1 ? `${displayName(ids[0])} is typing…` : `${ids.length} people are typing…`}
        </StatusLine>;
    }

    if (draft) return <StatusLine><span className={cl("draft")}>Draft:</span> {Parser.parseInlineReply(draft)}</StatusLine>;

    if (channel.isSystemDM()) return <>Official Discord Message</>;
    if (message) return <MessageLine channel={channel} user={user} message={message} />;
    if (channel.isMultiUserDM()) return <>{channel.recipients.length + 1} Members</>;
    return null;
}

export function SubText(props: PrivateChannelProps) {
    const { channel, user, activities, status, applicationStream, voiceChannel } = props;
    const { hideMuted, hideInStreamerMode, activityRule, previewLines } = settings.use([
        "hideMuted", "hideInStreamerMode", "activityRule", "previewLines", "senderAvatars", "boldUnread", "unreadCount",
        "fullTextTooltip", "jumpToMessage", "blurPreviews", "keywords", "staleAfter", "thumbnails",
        "drafts", "typingIndicator", "callIndicator"
    ]);

    const message = useLastMessage(channel.id);
    const typing = useTyping(channel.id);
    const draft = useDraft(channel.id);
    const callStart = useCallStart(channel.id);
    const streamerHidden = useStateFromStores([StreamerModeStore], () => StreamerModeStore.hidePersonalInformation);

    const hasActivity = hasRelevantActivity({ activities, status, applicationStream, voiceChannel });
    useMinute(Boolean(callStart) || settings.store.staleAfter > 0 || (hasActivity && activityRule === "switch"));

    const activity = hasActivity
        ? <ActivityText user={user} activities={activities} voiceChannel={voiceChannel} applicationStream={applicationStream} />
        : null;

    const hidden = (hideMuted && UserGuildSettingsStore.isChannelMuted(null!, channel.id)) || (hideInStreamerMode && streamerHidden);
    if (hidden) return activity;

    const urgent = Boolean(callStart || typing || draft);
    if (!urgent && hasActivity && showsActivity(message)) return activity;

    const preview = previewOf(props, message, typing, draft, callStart);
    const activityIcons = getActivityIcons(activities, user);

    return (
        <div className={classes(PrivateChannelClasses.subtext, previewLines === "2" && cl("two-lines"))}>
            {activityIcons
                ? <div className={cl("activity-row")}>{preview}{activityIcons}</div>
                : preview}
        </div>
    );
}

export function Decorator({ channel }: { channel: Channel; }) {
    const { hideMuted, timestampStyle } = settings.use(["hideMuted", "timestampStyle"]);
    const lastMessage = useLastMessage(channel.id);
    useMinute(Boolean(lastMessage) && timestampStyle === "relative");

    if (hideMuted && UserGuildSettingsStore.isChannelMuted(null!, channel.id)) return null;

    const isChannelPinned = UserGuildSettingsStore.isMessagesFavorite(channel.id);
    const isFavoritesEnabled = ExperimentStore.getUserExperimentBucket("2026-01-favorites-server") > 0;

    return <>
        {lastMessage && <span className={isFavoritesEnabled || isChannelPinned ? cl("timestamp-favorites") : cl("timestamp")}>
            {formatTimestamp(SnowflakeUtils.extractTimestamp(lastMessage.id))}
        </span>}
        <Actions channel={channel} />
    </>;
}
