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
import { Activity, ApplicationStream, Channel, Message, OnlineStatus, ReactionEmoji, User } from "@vencord/discord-types";
import { MessageType } from "@vencord/discord-types/enums";
import { findByCodeLazy, findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { CallStore, DraftStore, DraftType, ExperimentStore, IconUtils, NavigationRouter, Parser, ReadStateStore, ReferencedMessageStore, RelationshipStore, SelectedChannelStore, SnowflakeUtils, StreamerModeStore, Tooltip, TypingStore, UserGuildSettingsStore, UserStore, useStateFromStores } from "@webpack/common";

import { Actions } from "./Actions";
import { displayName, formatRelativeTime, formatTimestamp, getMessageContent, Icons, isStale, matchesKeyword, plainText } from "./content";
import { reactionOn, useLastMessage, useMinute } from "./hooks";
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

function typingName(userId: string) {
    const user = UserStore.getUser(userId);
    const smynName = user && isPluginEnabled(showMeYourName.name)
        ? showMeYourName.getTypingMemberListProfilesReactionsVoiceNameText({ user, type: "typingIndicator" })
        : null;
    return smynName || displayName(userId);
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

const EmojiImage = ({ emoji }: { emoji: ReactionEmoji; }) => emoji.id
    ? <img className={cl("emoji")} src={IconUtils.getEmojiURL({ id: emoji.id, animated: emoji.animated, size: 32 })} alt={`:${emoji.name}:`} />
    : <>{emoji.name}</>;

function repliesTo(message: Message, userId: string | undefined) {
    return message.type === MessageType.REPLY
        && ReferencedMessageStore.getMessageByReference(message.messageReference)?.message?.author.id === userId;
}

function MessageLine({ channel, user, message }: { channel: Channel; user: User | null | undefined; message: Message; }) {
    const { unread, count } = useUnread(channel.id);
    const smynName = isPluginEnabled(showMeYourName.name)
        ? showMeYourName.getTypingMemberListProfilesReactionsVoiceNameText({ user: user ?? message.author, type: "membersList" })
        : null;

    const content = getMessageContent(message);
    if (!content) return null;

    const { senderAvatars, boldUnread, unreadCount, fullTextTooltip, jumpToMessage, blurPreviews } = settings.store;
    const me = UserStore.getCurrentUser()?.id;
    const mine = message.author.id === me;
    const blocked = !mine && RelationshipStore.isBlockedOrIgnored(message.author.id);
    const reaction = mine ? reactionOn(message) : null;
    const authorName = authorNameOf(message, smynName);
    const raw = blocked ? "" : plainText(message);
    const Icon = content.icon && !blocked && !reaction ? Icons[content.icon] : null;

    const jump = (e: React.SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
        NavigationRouter.transitionTo(`/channels/@me/${channel.id}/${message.id}`);
    };

    const named = mine || channel.isMultiUserDM();
    const prefix = content.missed ? ""
        : content.action ? `${authorName} `
            : repliesTo(message, me) ? named ? `${authorName} replied to you: ` : "Replied to you: "
                : named ? `${authorName}: ` : "";

    const body = blocked ? "Blocked message"
        : reaction ? <>{reaction.userId ? `${displayName(reaction.userId)} reacted ` : "Reacted "}<EmojiImage emoji={reaction.emoji} /></>
            : <>
                {prefix}{content.text}
                {message.editedTimestamp && !content.action && <span className={cl("edited")}> (edited)</span>}
            </>;

    return (
        <Tooltip text={`${authorName}: ${raw}`} shouldShow={fullTextTooltip && Boolean(raw)}>
            {tooltipProps => (
                <div
                    {...tooltipProps}
                    className={classes(
                        ActivityClasses.container,
                        ActivityClasses.textXs,
                        cl("preview", {
                            unread: boldUnread && unread,
                            keyword: matchesKeyword(raw),
                            mentioned: message.mentioned && !mine && !blocked,
                            missed: content.missed,
                            stale: isStale(SnowflakeUtils.extractTimestamp(message.id)),
                            blurred: blurPreviews
                        })
                    )}
                    role={jumpToMessage ? "link" : undefined}
                    tabIndex={jumpToMessage ? 0 : undefined}
                    onClick={jumpToMessage ? e => jump(e) : tooltipProps.onClick}
                    onKeyDown={jumpToMessage ? e => e.key === "Enter" && jump(e) : undefined}
                >
                    {senderAvatars && <img className={cl("avatar")} src={IconUtils.getUserAvatarURL(message.author, false, 16)} alt="" />}
                    <span className={ActivityClasses.truncated}>{body}</span>
                    {Icon && (
                        <span className={cl("icon")}>
                            <Icon size="xxs" className={ActivityClasses.icon} />
                        </span>
                    )}
                    {unreadCount && count > 0 && <span className={cl("count")}>{count > 99 ? "99+" : count}</span>}
                </div>
            )}
        </Tooltip>
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
            {ids.length === 1 ? `${typingName(ids[0])} is typing…`
                : ids.length === 2 ? `${typingName(ids[0])} and ${typingName(ids[1])} are typing…`
                    : `${ids.length} people are typing…`}
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
    useMinute(Boolean(lastMessage) && timestampStyle !== "date");

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
