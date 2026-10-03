/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { applyIdleRules, autoGroupAll, BasicChannelTabsProps, ChannelTabsProps, clearStaleNavigationContext, closeTabAnimated, createTab, cycleRecentTab, endRecentCycle, getGroupSegments, handleChannelSwitch, isNavigationFromSource, isTabDragging, isTabSelected, jumpToUnreadTab, lastClosedTab, moveCurrentTab, moveToTab, openedTabs, openStartupTabs, saveTabs, settings, setUpdaterFunction, tabTitle, undoClose, ungroupAutoGroups, useGhostTabs } from "@equicordplugins/channelTabs/util";
import { IS_MAC } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { findComponentByCodeLazy } from "@webpack";
import { Button, ChannelRTCStore, ChannelStore, ContextMenuApi, FluxDispatcher, GuildStore, ReadStateStore, SelectedChannelStore, TextInput, Tooltip, useCallback, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import channelTabs from "..";
import { anyTabHasMention } from "../util/tabs";
import BookmarkContainer, { HorizontalScroller } from "./BookmarkContainer";
import ChannelTab, { PreviewTab } from "./ChannelTab";
import { AllTabsMenu, BasicContextMenu } from "./ContextMenus";
import TabGroup from "./TabGroup";

type TabSet = Record<string, ChannelTabsProps[]>;

const PlusSmallIcon = findComponentByCodeLazy("0v-5h5a1");

const cl = classNameFactory("vc-channeltabs-");

/** a dm has no name of its own, so it is searched by who is in it */
function tabText(tab: ChannelTabsProps): string {
    const channel = ChannelStore.getChannel(tab.channelId);
    const parts: (string | null | undefined)[] = [tabTitle(tab), channel?.name, GuildStore.getGuild(tab.guildId)?.name];

    for (const one of channel?.rawRecipients ?? []) parts.push(one.username, one.global_name);

    return parts.filter(Boolean).join(" ").toLowerCase();
}

export default function ChannelsTabsContainer(props: BasicChannelTabsProps) {
    const [userId, setUserId] = useState("");
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [searchIndex, setSearchIndex] = useState(0);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [tabsOverflow, setTabsOverflow] = useState(false);
    const {
        showBookmarkBar,
        widerTabsAndBookmarks,
        tabWidthScale,
        tabHeightScale,
        autoHideTabBar,
        revealOnMention,
        tabBarPosition,
        animationDragDrop,
        animationEnterExit,
        animationIconPop,
        animationMentionGlow,
        animationCompactExpand,
        animationSelectedBorder,
        animationSelectedBackground,
        animationTabShadows,
        animationTabPositioning,
        animationResizeHandle,
        animationQuestsActive,
        compactAutoExpandSelected,
        compactAutoExpandOnHover,
        newTabButtonBehavior,
        animationGroupExpand,
        autoGroupSameServer,
        autoCompactAfterHours,
        autoCloseAfterDays
    } = settings.use([
        "showBookmarkBar",
        "widerTabsAndBookmarks",
        "tabWidthScale",
        "tabHeightScale",
        "autoHideTabBar",
        "revealOnMention",
        "tabBarPosition",
        "animationDragDrop",
        "animationEnterExit",
        "animationIconPop",
        "animationMentionGlow",
        "animationCompactExpand",
        "animationSelectedBorder",
        "animationSelectedBackground",
        "animationTabShadows",
        "animationTabPositioning",
        "animationResizeHandle",
        "animationQuestsActive",
        "compactAutoExpandSelected",
        "compactAutoExpandOnHover",
        "newTabButtonBehavior",
        "animationGroupExpand",
        "autoGroupSameServer",
        "autoCompactAfterHours",
        "autoCloseAfterDays"
    ]);
    const GhostTabs = useGhostTabs();
    const isFullscreen = useStateFromStores([], () => ChannelRTCStore.isFullscreenInContext() ?? false);
    const hasMention = useStateFromStores([ReadStateStore, SelectedChannelStore], () => anyTabHasMention());
    const unreadIds = useStateFromStores([ReadStateStore], () => unreadOnly
        ? openedTabs.filter(tab => tab && (ReadStateStore.hasUnread(tab.channelId) || isTabSelected(tab.id))).map(tab => tab.id).join(",")
        : "", [unreadOnly]);
    const closed = lastClosedTab();

    useEffect(() => {
        if (!closed) return;
        const timer = setTimeout(() => _update(), closed.remaining);
        return () => clearTimeout(timer);
    }, [closed?.tab]);

    useEffect(() => {
        if (!userId || (!autoCompactAfterHours && !autoCloseAfterDays)) return;
        applyIdleRules();
        const timer = setInterval(applyIdleRules, 60_000);
        return () => clearInterval(timer);
    }, [userId, autoCompactAfterHours, autoCloseAfterDays]);

    useEffect(() => {
        if (!isSearchOpen) return;
        searchInputRef.current?.focus();
    }, [isSearchOpen]);

    const _update = useForceUpdater();
    const update = useCallback((save = true) => {
        _update();
        const currentUserId = UserStore.getCurrentUser()?.id;
        if (save && currentUserId) void saveTabs(currentUserId);
    }, []);

    const ref = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const currentChannelRef = useRef(props);
    currentChannelRef.current = props;

    useEffect(() => {
        return setUpdaterFunction(update);
    }, [update]);

    useEffect(() => {
        const onLogin = () => {
            const user = UserStore.getCurrentUser();
            if (!user) return;

            void openStartupTabs({ ...currentChannelRef.current, userId: user.id }, setUserId);
        };

        onLogin();
        FluxDispatcher.subscribe("CONNECTION_OPEN_SUPPLEMENTAL", onLogin);
        return () => {
            FluxDispatcher.unsubscribe("CONNECTION_OPEN_SUPPLEMENTAL", onLogin);
        };
    }, []);

    useEffect(() => {
        if (ref.current) {
            try {
                channelTabs.containerHeight = ref.current.clientHeight;
            } catch { }
        }
    }, [userId, showBookmarkBar, tabBarPosition]);

    useEffect(() => {
        _update();
    }, [widerTabsAndBookmarks]);

    useEffect(() => {
        if (autoGroupSameServer) autoGroupAll();
        else ungroupAutoGroups();
        update();
    }, [autoGroupSameServer]);
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;

        const checkOverflow = () => setTabsOverflow(scroller.scrollWidth > scroller.clientWidth);

        checkOverflow();

        const observer = new ResizeObserver(checkOverflow);
        observer.observe(scroller);

        return () => observer.disconnect();
    }, [openedTabs.length, newTabButtonBehavior]);

    useEffect(() => {
        const matchesKeybind = (event: KeyboardEvent, keybindString: string): boolean => {
            const parts = keybindString.split("+");
            const hasCtrl = parts.includes("CTRL");
            const hasShift = parts.includes("SHIFT");
            const hasAlt = parts.includes("ALT");
            const mainKey = parts[parts.length - 1].toLowerCase();
            const keyPressed = event.key.toLowerCase();
            const expected = mainKey === "space" ? " " : mainKey;

            return hasCtrl === (event.ctrlKey || event.metaKey) && hasShift === event.shiftKey && hasAlt === event.altKey && keyPressed === expected;
        };

        const editable = (target: HTMLElement) => target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

        const handleKeyDown = (event: KeyboardEvent) => {
            const { store } = settings;
            const typedCharacter = !(event.ctrlKey || event.metaKey || event.altKey) || event.getModifierState("AltGraph");
            if (editable(event.target as HTMLElement) && typedCharacter) return;

            const digit = /^Digit([1-9])$/.exec(event.code);
            if (store.enableNumberKeySwitching && digit && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                const number = Number(digit[1]);
                const tab = openedTabs[number - 1];
                if (tab && number <= store.numberKeySwitchCount) {
                    event.preventDefault();
                    moveToTab(tab.id);
                }
                return;
            }

            if (store.enableMoveTabShortcut && matchesKeybind(event, store.moveTabLeftKeybind)) {
                event.preventDefault();
                moveCurrentTab(-1);
                return;
            }

            if (store.enableMoveTabShortcut && matchesKeybind(event, store.moveTabRightKeybind)) {
                event.preventDefault();
                moveCurrentTab(1);
                return;
            }

            if (store.enableUnreadJumpShortcut && matchesKeybind(event, store.unreadJumpKeybind)) {
                event.preventDefault();
                event.stopPropagation();
                jumpToUnreadTab();
                return;
            }

            if (store.enableCloseTabShortcut && matchesKeybind(event, store.closeTabKeybind)) {
                event.preventDefault();
                const currentTab = openedTabs.find(t => isTabSelected(t.id));
                if (currentTab) closeTabAnimated(currentTab.id);
                return;
            }

            if (store.enableNewTabShortcut && matchesKeybind(event, store.newTabKeybind)) {
                event.preventDefault();
                event.stopPropagation();
                createTab(currentChannelRef.current, true);
                FluxDispatcher.dispatch({ type: "QUICKSWITCHER_SHOW", query: "", queryMode: null });
                return;
            }

            const forward = matchesKeybind(event, store.cycleTabForwardKeybind);
            if (!store.enableTabCycleShortcut || !(forward || matchesKeybind(event, store.cycleTabBackwardKeybind))) return;

            event.preventDefault();
            event.stopPropagation();
            if (store.cycleOrder === "recent") {
                cycleRecentTab(forward ? 1 : -1);
                return;
            }

            const currentIndex = openedTabs.findIndex(t => isTabSelected(t.id));
            if (currentIndex !== -1 && openedTabs.length > 1)
                moveToTab(openedTabs[(currentIndex + (forward ? 1 : -1) + openedTabs.length) % openedTabs.length].id);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Control" || event.key === "Meta") endRecentCycle();
        };

        document.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("blur", endRecentCycle);

        return () => {
            document.removeEventListener("keydown", handleKeyDown, true);
            document.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("blur", endRecentCycle);
        };
    }, []);

    useEffect(() => {
        if (userId) {
            // Normalize guildId for comparison
            const normalizedGuildId = props.guildId || "@me";

            // Skip if this navigation came from a bookmark
            if (!isNavigationFromSource(normalizedGuildId, props.channelId, "bookmark")) {
                handleChannelSwitch(props);
            }

            saveTabs(userId);

            // Clean up any stale navigation contexts
            clearStaleNavigationContext();
        }
    }, [userId, props.channelId, props.guildId]);

    if (!userId) return null;

    if (isFullscreen) return null;

    let tabIndex = 0;
    const segments = getGroupSegments().map(segment => {
        if (!("group" in segment)) return <ChannelTab {...segment} index={tabIndex++} key={segment.id} />;

        const start = tabIndex;
        tabIndex += segment.tabs.length;
        return <TabGroup group={segment.group} tabs={segment.tabs} index={start} key={`${segment.group.id}-${segment.tabs[0].id}`} />;
    });

    const shouldFollowNewTabButton = newTabButtonBehavior && !tabsOverflow;
    const query = searchQuery.trim().toLowerCase();
    const searchActive = query.length > 0;
    const filtering = searchActive || unreadOnly;
    const unread = new Set(unreadIds ? unreadIds.split(",").map(Number) : []);
    const visible = filtering
        ? openedTabs.map((tab, i) => ({ tab, i })).filter(({ tab }) =>
            tab != null && (!searchActive || tabText(tab).includes(query)) && (!unreadOnly || unread.has(tab.id)))
        : [];
    const focused = searchActive ? visible[Math.min(searchIndex, visible.length - 1)] : undefined;

    const searchBox = (
        <div className={classes(cl("tab-search-shell"), isSearchOpen && cl("tab-search-shell-open"), searchActive && cl("search-counted"))}>
            <div className={cl("tab-search-field")}>
                <TextInput
                    inputRef={searchInputRef}
                    inputClassName={cl("tab-search-input")}
                    style={{ width: "100%" }}
                    value={searchQuery}
                    onChange={value => {
                        setSearchQuery(value);
                        setSearchIndex(0);
                    }}
                    placeholder="Search tabs"
                    onBlur={() => {
                        if (!searchQuery.trim()) setIsSearchOpen(false);
                    }}
                    onKeyDown={e => {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            const step = e.key === "ArrowDown" ? 1 : -1;
                            setSearchIndex(i => Math.max(0, Math.min(i + step, visible.length - 1)));
                            return;
                        }
                        if (e.key === "Enter" && focused) {
                            moveToTab(focused.tab.id);
                            setSearchQuery("");
                            setIsSearchOpen(false);
                            return;
                        }
                        if (e.key !== "Escape") return;
                        if (searchQuery.trim()) setSearchQuery("");
                        else setIsSearchOpen(false);
                    }}
                />
                {searchActive && <span className={cl("search-count")}>{visible.length}</span>}
            </div>
            <Tooltip text="Search tabs" position="left">
                {p => <button
                    className={classes(cl("button"), cl("tab-search-button"))}
                    {...p}
                    onClick={() => {
                        if (isSearchOpen && !searchQuery.trim()) {
                            setIsSearchOpen(false);
                            return;
                        }
                        setIsSearchOpen(true);
                    }}
                >
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                        <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </button>}
            </Tooltip>
        </div>
    );

    const unreadButton = (
        <Tooltip text={unreadOnly ? "Show all tabs" : "Only unread tabs"} position="left">
            {p => <button
                {...p}
                className={classes(cl("button"), cl("bar-button"), unreadOnly && cl("bar-button-active"))}
                aria-pressed={unreadOnly}
                onClick={() => setUnreadOnly(on => !on)}
            >
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
            </button>}
        </Tooltip>
    );

    const allTabsButton = tabsOverflow && (
        <Tooltip text="All tabs" position="left">
            {p => <button
                {...p}
                className={classes(cl("button"), cl("bar-button"))}
                onClick={e => ContextMenuApi.openContextMenu(e, () => <AllTabsMenu />)}
            >
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>}
        </Tooltip>
    );

    const newTabButton = (
        <button
            onClick={() => createTab(props, true)}
            className={cl("button", "new-button")}
            aria-label="New tab"
        >
            <PlusSmallIcon />
        </button>
    );

    return (
        <div
            className={classes(
                cl("container"),
                tabBarPosition === "top" && cl("container-top"),
                IS_MAC && !IS_WEB && tabBarPosition === "top" && cl("container-top-macos"),
                !animationDragDrop && cl("no-drag-animation"),
                !animationEnterExit && cl("no-enter-exit-animation"),
                !animationIconPop && cl("no-icon-pop-animation"),
                !animationMentionGlow && cl("no-mention-glow"),
                !animationCompactExpand && cl("no-compact-animation"),
                !animationSelectedBorder && cl("no-selected-border"),
                !animationSelectedBackground && cl("no-selected-background"),
                !animationTabShadows && cl("no-tab-shadows"),
                !animationTabPositioning && cl("no-tab-positioning"),
                !animationResizeHandle && cl("no-resize-handle-animation"),
                !animationQuestsActive && cl("no-quests-active-animation"),
                autoHideTabBar && cl("container-autohide"),
                autoHideTabBar && revealOnMention && hasMention && cl("container-revealed"),
                !compactAutoExpandSelected && cl("no-compact-auto-expand"),
                !compactAutoExpandOnHover && cl("no-compact-hover-expand"),
                !animationGroupExpand && cl("no-group-expand-animation")
            )}
            ref={ref}
            style={{ "--tab-width-scale": tabWidthScale / 100, "--tab-height-scale": tabHeightScale / 100 } as React.CSSProperties}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <BasicContextMenu />)}
        >
            {showBookmarkBar && <BookmarkContainer {...props} userId={userId} />}
            <div
                className={cl("tab-container", { "tab-container-dragging": isTabDragging() })}
                onDoubleClick={e => {
                    if (e.target === e.currentTarget) createTab(props, true);
                }}
            >
                <HorizontalScroller
                    customRef={node => { scrollerRef.current = node; }}
                    className={cl("tab-scroller", shouldFollowNewTabButton && "tab-scroller-following")}
                >
                    {filtering
                        ? visible.map(({ tab, i }) =>
                            <ChannelTab {...tab} index={i} key={tab.id} searchActive={filtering} searchFocused={focused?.tab.id === tab.id} />
                        )
                        : segments}
                    {GhostTabs}
                    {shouldFollowNewTabButton && newTabButton}
                </HorizontalScroller>

                {!shouldFollowNewTabButton && newTabButton}
                {allTabsButton}
                {unreadButton}
                {searchBox}
            </div>

            {closed && <button className={cl("button", "undo")} onClick={undoClose}>
                <span className={cl("undo-name")}>Closed {tabTitle(closed.tab)}</span>
                <span className={cl("undo-action")}>Undo</span>
            </button>}
        </div>
    );
}

export function ChannelTabsPreview(p: { setValue: (v: TabSet) => void; }) {
    const id = UserStore.getCurrentUser()?.id;
    if (!id) return <Paragraph>there's no logged in account?????</Paragraph>;

    const { setValue } = p;
    const { tabSet }: { tabSet: TabSet; } = settings.use(["tabSet"]);

    const placeholder = [{ guildId: "@me", channelId: undefined as any }];
    const [currentTabs, setCurrentTabs] = useState(tabSet?.[id] ?? placeholder);

    return (
        <>
            <Heading>Startup tabs</Heading>
            <Flex flexDirection="row" style={{ gap: "2px" }}>
                {currentTabs.map(t => <>
                    <PreviewTab {...t} />
                </>)}
            </Flex>
            <Flex flexDirection="row-reverse">
                <Button
                    onClick={() => {
                        setCurrentTabs([...openedTabs]);
                        setValue({ ...tabSet, [id]: [...openedTabs] });
                    }}
                >Set to currently open tabs</Button>
            </Flex>
        </>
    );
}
