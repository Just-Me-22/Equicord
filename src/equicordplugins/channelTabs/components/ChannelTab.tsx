/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { PencilIcon } from "@components/Icons";
import { ChannelTabsProps, closeTabAnimated, ensureUnreadFallbackCountsLoaded, enteredTabs, getNotificationDotState, getUnreadFallbackCounts, groupTabs, guildColor, isTabClosing, isTabSelected, moveDraggedGroup, moveDraggedTabs, moveToTab, openedTabs, removeFromGroup, setTabDragging, settings, tabTitle, updateUnreadFallbackCounts } from "@equicordplugins/channelTabs/util";
import { ActivityIcon, CircleQuestionIcon, DiscoveryIcon, EnvelopeIcon, FriendsIcon, ICYMIIcon, NitroIcon, QuestIcon, ShopIcon } from "@equicordplugins/channelTabs/util/icons";
import { getActiveAutoCompletes } from "@equicordplugins/questify/utils/completion";
import { classNameFactory } from "@utils/css";
import { getGuildAcronym, getIntlMessage } from "@utils/discord";
import { classes, pluralize } from "@utils/misc";
import { Channel, Guild, User } from "@vencord/discord-types";
import { DraftType } from "@vencord/discord-types/enums";
import { findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { ActiveJoinedThreadsStore, Avatar, ChannelStore, ContextMenuApi, DraftStore, GuildStore, MessageStore, PresenceStore, ReadStateStore, Tooltip, TypingStore, useDrag, useDrop, useEffect, useRef, UserGuildSettingsStore, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";
import { JSX } from "react";

import { TabContextMenu } from "./ContextMenus";

const ThreeDots = findComponentByCodeLazy("Math.min(1,Math.max(", "dotRadius:");
const dotStyles = findCssClassesLazy("numberBadge", "baseShapeRound");

const ChannelTypeIcon = findComponentByCodeLazy('"ChannelItemIcon")');

// Custom SVG icons for pages that don't have findable components

function LibraryIcon(height: number = 20, width: number = 20, className?: string): JSX.Element {
    return (
        <svg
            viewBox="0 0 24 24"
            height={height}
            width={width}
            fill="none"
            className={className}
        >
            <path fill="currentColor" d="M3 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3zm2 1v16h10V4H5zm13-1h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-2V3zm0 2v12h1V5h-1z" />
        </svg>
    );
}

const cl = classNameFactory("vc-channeltabs-");

function XIcon({ size, fill }: { size: number, fill: string; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24">
        <path fill={fill}
            d="M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"
        />
    </svg>;
}

export const GuildIcon = ({ guild }: { guild: Guild; }) => {
    return guild.icon
        ? <img
            src={`https://${window.GLOBAL_ENV.CDN_HOST}/icons/${guild?.id}/${guild?.icon}.png`}
            className={cl("icon")}
        />
        : <div className={cl("guild-acronym-icon")}>
            <BaseText size="xs" weight="semibold" tag="span">{getGuildAcronym(guild)}</BaseText>
        </div>;
};

export const ChannelIcon = ({ channel }: { channel: Channel; }) =>
    <img
        src={channel?.icon
            ? `https://${window.GLOBAL_ENV.CDN_HOST}/channel-icons/${channel?.id}/${channel?.icon}.png`
            : "https://discord.com/assets/c6851bd0b03f1cca5a8c1e720ea6ea17.png" // Default Group Icon
        }
        className={cl("icon")}
    />;

function TypingIndicator({ isTyping }: { isTyping: boolean; }) {
    return isTyping
        ? <ThreeDots dotRadius={3} themed={true} className={cl("typing-indicator")} />
        : null;
}

function getChannelUnreadState(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    const newForumPostCount = channel?.guild_id && channel.isForumLikeChannel?.()
        ? ActiveJoinedThreadsStore.getNewThreadCount(channel.guild_id, channel.id)
        : 0;
    const unreadCount = ReadStateStore.getUnreadCount(channelId) || newForumPostCount;

    return {
        channelId,
        hasUnread: ReadStateStore.hasUnread(channelId) || newForumPostCount > 0,
        mentionCount: ReadStateStore.getMentionCount(channelId),
        unreadCount
    };
}

type BadgeState = "mention" | "unread" | null;

export const NotificationDot = ({ channelIds, onBadge }: { channelIds: string[]; onBadge?: (badge: BadgeState) => void; }) => {
    const userId = UserStore.getCurrentUser()?.id;
    const { persistUnreadCountFallback } = settings.use(["persistUnreadCountFallback"]);
    const [, forceUpdate] = useState(0);
    const channelStateKey = channelIds.join(",");
    const channelStates = useStateFromStores(
        [ActiveJoinedThreadsStore, ReadStateStore],
        () => channelIds.map(getChannelUnreadState)
    );
    const stateSignature = channelStates.map(state => `${state.channelId}:${Number(state.hasUnread)}:${state.mentionCount}:${state.unreadCount}`).join("|");
    const { badgeText, hasMention, shouldShow } = getNotificationDotState(
        channelStates,
        userId ? getUnreadFallbackCounts(userId) : {},
        persistUnreadCountFallback
    );

    const badge: BadgeState = !shouldShow ? null : hasMention ? "mention" : "unread";
    useEffect(() => {
        onBadge?.(badge);
    }, [badge, onBadge]);
    useEffect(() => () => onBadge?.(null), [onBadge]);

    useEffect(() => {
        if (!userId || !persistUnreadCountFallback) return;

        let didCancel = false;
        ensureUnreadFallbackCountsLoaded(userId).then(() => {
            if (didCancel) return;
            forceUpdate(prev => prev + 1);
        });

        return () => {
            didCancel = true;
        };
    }, [persistUnreadCountFallback, userId]);

    useEffect(() => {
        if (!userId || !persistUnreadCountFallback) return;
        updateUnreadFallbackCounts(userId, channelStates);
    }, [channelStateKey, persistUnreadCountFallback, stateSignature, userId]);

    return shouldShow ?
        <div
            data-has-mention={hasMention}
            className={classes(cl("notification-badge"), dotStyles.numberBadge, dotStyles.baseShapeRound)}
        >
            {badgeText}
        </div> : null;
};

interface TabNumberBadgeProps {
    number: number;
    position: "left" | "right";
    isSelected: boolean;
    isCompact: boolean;
    isHovered: boolean;
}

export const TabNumberBadge = ({ number, position, isSelected, isCompact, isHovered }: TabNumberBadgeProps) => {
    // hide badge if:
    // 1. tab is currently selected
    // 2. tab is compact AND not hovered
    const shouldHide = isSelected || (isCompact && !isHovered);

    if (shouldHide) return null;

    return (
        <div
            className={cl("tab-number-badge", `position-${position}`)}
            data-position={position}
        >
            {number}
        </div>
    );
};

const specialPageIcons: Record<string, React.ComponentType<any>> = {
    "__quests__": QuestIcon,
    "__message-requests__": EnvelopeIcon,
    "__friends__": FriendsIcon,
    "__shop__": ShopIcon,
    "__library__": () => LibraryIcon(20, 20),
    "__discovery__": DiscoveryIcon,
    "__nitro__": NitroIcon,
    "__icymi__": ICYMIIcon,
    "__activity__": ActivityIcon
};

function DraftMark({ channelId, tabId }: { channelId: string; tabId: number; }) {
    const hasDraft = useStateFromStores([DraftStore], () => !!DraftStore.getDraft(channelId, DraftType.ChannelMessage));
    if (!hasDraft || isTabSelected(tabId)) return null;
    return <PencilIcon className={cl("draft-mark")} width={14} height={14} aria-label="Unsent draft" />;
}

function VoiceAvatars({ channel }: { channel: Channel; }) {
    const ids = useStateFromStores([VoiceStateStore], () => Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id) ?? {}).join(","));
    if (!ids) return null;

    const everyone = ids.split(",");
    return (
        <div className={cl("voice-avatars")}>
            {everyone.slice(0, 3).map(id => UserStore.getUser(id)).filter(Boolean).map(user =>
                <img key={user.id} className={cl("voice-avatar")} src={user.getAvatarURL(channel.guild_id, 32)} alt="" />
            )}
            {everyone.length > 3 && <span className={cl("voice-more")}>+{everyone.length - 3}</span>}
        </div>
    );
}

function ChannelName({ channel, label }: { channel: Channel; label?: string; }) {
    const parent = !label && channel.isThread() ? ChannelStore.getChannel(channel.parent_id)?.name : undefined;
    return (
        <BaseText className={cl("name-text")}>
            {parent && <span className={cl("thread-parent")}>{parent} › </span>}
            {label ?? channel.name}
        </BaseText>
    );
}

function plainText(content: string) {
    return content
        .replace(/<a?(:\w+:)\d+>/g, "$1")
        .replace(/<@!?(\d+)>/g, (_, id) => `@${UserStore.getUser(id)?.username ?? "user"}`)
        .replace(/<#(\d+)>/g, (_, id) => `#${ChannelStore.getChannel(id)?.name ?? "channel"}`);
}

function TabTooltip({ tab }: { tab: ChannelTabsProps; }) {
    const guild = GuildStore.getGuild(tab.guildId);
    const mentions = ReadStateStore.getMentionCount(tab.channelId);
    const unread = ReadStateStore.getUnreadCount(tab.channelId);
    const recent = ChannelStore.getChannel(tab.channelId) ? MessageStore.getMessages(tab.channelId)?._array?.slice(-3) ?? [] : [];

    return (
        <div className={cl("tooltip-body")}>
            <div className={cl("tooltip-title")}>{[guild?.name, tabTitle(tab)].filter(Boolean).join(" / ")}</div>
            {(mentions > 0 || unread > 0) && <div className={cl("tooltip-meta")}>
                {mentions > 0 ? pluralize(mentions, "mention") : `${unread} unread`}
            </div>}
            {recent.map(message => (
                <div key={message.id} className={cl("tooltip-line")}>
                    <span className={cl("tooltip-author")}>{message.author.globalName ?? message.author.username}</span>
                    {" "}{plainText(message.content) || "…"}
                </div>
            ))}
        </div>
    );
}

function ChannelTabContent(props: ChannelTabsProps & {
    guild?: Guild,
    channel?: Channel;
    onBadge?: (badge: BadgeState) => void;
}) {
    const { guild, guildId, channel, channelId, onBadge, label } = props;
    const userId = UserStore.getCurrentUser()?.id;
    const recipients = channel?.recipients;
    const {
        showStatusIndicators
    } = settings.use(["showStatusIndicators"]);

    const [isTyping, status, isMobile] = useStateFromStores(
        [TypingStore, PresenceStore],
        () => {
            const recipientId = recipients?.[0] ?? "";

            return [
                !!((Object.keys(TypingStore.getTypingUsers(props.channelId)) as string[]).filter(id => id !== userId).length),
                PresenceStore.getStatus(recipientId),
                PresenceStore.isMobileOnline(recipientId)
            ];
        }
    );

    if (guild) {
        if (channel)
            return (
                <>
                    <GuildIcon guild={guild} />
                    <ChannelTypeIcon channel={channel} guild={guild} />
                    <ChannelName channel={channel} label={label} />
                    {(channel.isGuildVoice() || channel.isGuildStageVoice()) && <VoiceAvatars channel={channel} />}
                    <DraftMark channelId={channel.id} tabId={props.id} />
                    <NotificationDot channelIds={[channel.id]} onBadge={onBadge} />
                    <TypingIndicator isTyping={isTyping} />
                </>
            );
        else {
            let name = `${getIntlMessage("UNKNOWN_CHANNEL")} (${channelId})`;
            switch (channelId) {
                case "customize-community":
                    name = getIntlMessage("CHANNELS_AND_ROLES");
                    break;
                case "channel-browser":
                    name = getIntlMessage("GUILD_SIDEBAR_CHANNEL_BROWSER");
                    break;
                case "shop":
                    name = getIntlMessage("GUILD_SHOP_CHANNEL_LABEL");
                    break;
                case "member-safety":
                    name = getIntlMessage("MEMBER_SAFETY_CHANNEL_TITLE");
                    break;
                case "@home":
                    name = getIntlMessage("SERVER_GUIDE");
                    break;
            }
            return (
                <>
                    <GuildIcon guild={guild} />
                    <BaseText className={cl("name-text")}>{label ?? name}</BaseText>
                </>
            );
        }
    }

    if (channel && recipients?.length) {
        if (recipients.length === 1) {
            const user = UserStore.getUser(recipients[0]) as User & { globalName: string; };
            const username = user.globalName || user.username;

            return (
                <>
                    <Avatar
                        size="SIZE_24"
                        src={user.getAvatarURL(guildId, 128)}
                        status={showStatusIndicators ? status : undefined}
                        isTyping={isTyping}
                        isMobile={isMobile}
                    />
                    <BaseText className={cl("name-text")}>
                        {label ?? username}
                    </BaseText>
                    <DraftMark channelId={channel.id} tabId={props.id} />
                    <NotificationDot channelIds={[channel.id]} onBadge={onBadge} />
                    {!showStatusIndicators && <TypingIndicator isTyping={isTyping} />}
                </>
            );
        } else {
            // Group DM
            return (
                <>
                    <ChannelIcon channel={channel} />
                    <BaseText className={cl("name-text")}>{label ?? (channel?.name || getIntlMessage("GROUP_DM"))}</BaseText>
                    <DraftMark channelId={channel.id} tabId={props.id} />
                    <NotificationDot channelIds={[channel.id]} onBadge={onBadge} />
                    <TypingIndicator isTyping={isTyping} />
                </>
            );
        }
    }

    const PageIcon = specialPageIcons[channelId];
    if (PageIcon) {
        return (
            <>
                <PageIcon />
                <BaseText className={cl("name-text")}>{tabTitle(props)}</BaseText>
            </>
        );
    }

    if (guildId === "@me" || guildId === undefined) {
        return (
            <>
                <FriendsIcon />
                <BaseText className={cl("name-text")}>{getIntlMessage("FRIENDS")}</BaseText>
            </>
        );
    }

    return (
        <>
            <CircleQuestionIcon />
            <BaseText className={cl("name-text")}>{getIntlMessage("UNKNOWN_CHANNEL")}</BaseText>
        </>
    );
}

export default function ChannelTab(props: ChannelTabsProps & { index: number; searchActive?: boolean; searchFocused?: boolean; }) {
    const { channelId, guildId, id, index, compact, searchActive, searchFocused } = props;
    const guild = GuildStore.getGuild(guildId);
    const channel = ChannelStore.getChannel(channelId);

    const [isEntering, setIsEntering] = useState(() => !enteredTabs.has(id));
    const [isDragging, setIsDragging] = useState(false);
    const [isDropTarget, setIsDropTarget] = useState(false);
    const [isGroupTarget, setIsGroupTarget] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [badge, setBadge] = useState<BadgeState>(null);
    const isMuted = useStateFromStores([UserGuildSettingsStore], () =>
        !!channel && (guild
            ? UserGuildSettingsStore.isChannelMuted(guildId, channelId) || UserGuildSettingsStore.isCategoryMuted(guildId, channelId)
            : UserGuildSettingsStore.isChannelMuted(null, channelId)),
    [channelId, guildId, !!channel, !!guild]);

    const { showTabNumbers, tabNumberPosition, tabBarPosition } = settings.use(["showTabNumbers", "tabNumberPosition", "tabBarPosition"]);

    useEffect(() => {
        enteredTabs.add(id);
    }, [id]);

    useEffect(() => {
        if (isEntering) {
            const timer = setTimeout(() => setIsEntering(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isEntering]);

    useEffect(() => {
        if ((isDropTarget || isGroupTarget) && !isDragging) {
            const timer = setTimeout(() => {
                setIsDropTarget(false);
                setIsGroupTarget(false);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [isDropTarget, isGroupTarget, isDragging]);

    const ref = useRef<HTMLDivElement>(null);
    const groupTargetRef = useRef(false);
    const lastSwapTimeRef = useRef(0);
    const SWAP_THROTTLE_MS = 100;

    useEffect(() => {
        if (searchFocused) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [searchFocused]);

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startWidth = ref.current?.getBoundingClientRect().width || 0;
        const baseWidth = 192; // 12rem in pixels (assuming 16px base font)
        let pendingScale = settings.store.tabWidthScale;

        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const newWidth = startWidth + deltaX;
            const newScale = newWidth / baseWidth;

            // 50% and 200% scale
            const clampedScale = Math.max(0.5, Math.min(2, newScale));
            pendingScale = Math.round(clampedScale * 100);

            // update CSS variable immediately for visual feedback
            if (ref.current) {
                ref.current.style.setProperty("--tab-width-scale", String(pendingScale / 100));
            }
        };

        const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";

            settings.store.tabWidthScale = pendingScale;

            if (ref.current) {
                ref.current.style.removeProperty("--tab-width-scale");
            }
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    };

    const [, drag] = useDrag(() => ({
        type: "vc_ChannelTab",
        canDrag: () => !searchActive,
        item: () => {
            setIsDragging(true);
            setTabDragging(true);
            lastSwapTimeRef.current = Date.now() - SWAP_THROTTLE_MS;

            // get fresh tab data dynamically to avoid stale closures
            const tab = openedTabs.find(t => t.id === id);

            return {
                id,
                channelId: tab?.channelId || channelId,
                guildId: tab?.guildId || guildId
            };
        },
        collect: monitor => ({
            isDragging: !!monitor.isDragging()
        }),
        end: (item, monitor) => {
            setIsDragging(false);
            setTabDragging(false);
            setIsDropTarget(false);
            lastSwapTimeRef.current = 0;

            if (monitor.didDrop() || !openedTabs.find(t => t.id === id)?.groupId) return;

            const offset = monitor.getClientOffset();
            const rect = ref.current?.getBoundingClientRect();
            if (offset && rect && offset.y > rect.bottom) removeFromGroup(id, true);
        }
    }), [id, channelId, guildId, searchActive]);
    const [, drop] = useDrop(() => ({
        accept: "vc_ChannelTab",
        hover: (item: { id: number; groupId?: string; }, monitor) => {
            if (!ref.current) return;

            const now = Date.now();
            const draggedId = item.id;
            const hoveredId = id;

            if (draggedId === hoveredId) return;

            const hoverIndex = openedTabs.findIndex(t => t.id === hoveredId);
            if (hoverIndex === -1) return;

            const isOver = monitor.isOver({ shallow: true });
            setIsDropTarget(isOver);

            if (now - lastSwapTimeRef.current < SWAP_THROTTLE_MS) {
                return;
            }

            if (item.groupId) {
                if (item.groupId === openedTabs[hoverIndex].groupId) return;
                lastSwapTimeRef.current = now;
                moveDraggedGroup(item.groupId, hoverIndex);
                return;
            }

            const dragIndex = openedTabs.findIndex(t => t.id === draggedId);
            if (dragIndex === -1) return;

            const hoverBoundingRect = ref.current.getBoundingClientRect();
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;

            const hoverClientX = clientOffset.x - hoverBoundingRect.left;
            const hoverWidth = hoverBoundingRect.right - hoverBoundingRect.left;

            // zones are measured from the cursor, not the dragged tab's edge. an edge test
            // fires the swap the moment you touch the target, which slides it out from
            // under you and makes the middle unreachable.
            const groupZoneStart = hoverWidth * settings.store.groupDropZone / 200;
            const hoveredGroupId = openedTabs[hoverIndex].groupId;
            const inCentreBand = hoverClientX > hoverWidth / 2 - groupZoneStart && hoverClientX < hoverWidth / 2 + groupZoneStart;
            if (inCentreBand && settings.store.groupDropZone > 0 && (!hoveredGroupId || hoveredGroupId !== openedTabs[dragIndex].groupId)) {
                groupTargetRef.current = true;
                setIsGroupTarget(true);
                return;
            }
            groupTargetRef.current = false;
            setIsGroupTarget(false);

            if (dragIndex < hoverIndex && hoverClientX < hoverWidth / 2 + groupZoneStart) return;
            if (dragIndex > hoverIndex && hoverClientX > hoverWidth / 2 - groupZoneStart) return;

            lastSwapTimeRef.current = now;
            moveDraggedTabs(dragIndex, hoverIndex);
        },
        drop: (item: { id: number; groupId?: string; }) => {
            setIsDropTarget(false);
            setIsGroupTarget(false);
            if (!groupTargetRef.current) return;

            groupTargetRef.current = false;
            groupTabs(item.id, id);
        }
    }), [id]);
    drag(drop(ref));

    const isClosing = isTabClosing(id);
    return <Tooltip
        text={<TabTooltip tab={props} />}
        position={tabBarPosition === "top" ? "bottom" : "top"}
        tooltipClassName={cl("tooltip")}
        delay={500}
        shouldShow={!isDragging && !isClosing}
    >
        {tooltipProps => <div
            className={cl("tab", {
                "tab-compact": compact,
                "tab-closable": openedTabs.length > 1,
                "tab-selected": isTabSelected(id),
                "tab-entering": isEntering,
                "tab-closing": isClosing,
                "tab-dragging": isDragging,
                "tab-mention": badge === "mention",
                "tab-unread": badge !== null,
                "tab-muted": isMuted,
                "tab-drop-target": isDropTarget && !isGroupTarget,
                "tab-group-target": isGroupTarget,
                "tab-pinned": !!props.pinned,
                "tab-nitro": channelId === "__nitro__",
                "tab-quests-active": channelId === "__quests__" && getActiveAutoCompletes().length > 0,
                "tab-search-focused": !!searchFocused,
                wider: settings.store.widerTabsAndBookmarks
            })}
            key={index}
            ref={ref}
            style={settings.store.colorTabsByServer
                ? { "--vc-channeltabs-guild": guildColor(guildId) } as React.CSSProperties
                : undefined}
            onMouseEnter={() => {
                tooltipProps.onMouseEnter();
                if (showTabNumbers) setIsHovered(true);
            }}
            onMouseLeave={() => {
                tooltipProps.onMouseLeave();
                if (showTabNumbers) setIsHovered(false);
            }}
            onClick={tooltipProps.onClick}
            onAuxClick={e => {
                if (e.button === 1) closeTabAnimated(id);
            }}
            onContextMenu={e => {
                tooltipProps.onContextMenu();
                ContextMenuApi.openContextMenu(e, () => <TabContextMenu tab={props} />);
            }}
        >
            <button
                className={cl("button", "channel-info")}
                onClick={() => moveToTab(id)}
            >
                <div
                    className={cl("tab-inner")}
                    data-compact={compact}
                >
                    {/* left position badge */}
                    {showTabNumbers && tabNumberPosition === "left" && (
                        <TabNumberBadge
                            number={index + 1}
                            position="left"
                            isSelected={isTabSelected(id)}
                            isCompact={compact}
                            isHovered={isHovered}
                        />
                    )}

                    <ChannelTabContent {...props} guild={guild} channel={channel} onBadge={setBadge} />

                    {/* right position badge */}
                    {showTabNumbers && tabNumberPosition === "right" && (
                        <TabNumberBadge
                            number={index + 1}
                            position="right"
                            isSelected={isTabSelected(id)}
                            isCompact={compact}
                            isHovered={isHovered}
                        />
                    )}
                </div>
            </button>

            {openedTabs.length > 1 && <button
                className={cl("button", "close-button", { "close-button-compact": compact })}
                aria-label="Close tab"
                onClick={() => closeTabAnimated(id)}
            >
                <XIcon size={16} fill="var(--interactive-icon-default)" />
            </button>}

            {!compact && settings.store.showResizeHandle && <div
                className={cl("tab-resize-handle")}
                onMouseDown={handleResizeStart}
            />}
        </div>}
    </Tooltip>;
}

export const PreviewTab = (props: ChannelTabsProps) => {
    const guild = GuildStore.getGuild(props.guildId);
    const channel = ChannelStore.getChannel(props.channelId);

    return (
        <div className={classes(cl("preview-tab"), props.compact ? cl("preview-tab-compact") : null)}>
            <ChannelTabContent {...props} guild={guild} channel={channel} />
        </div>
    );
};
