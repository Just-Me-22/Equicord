/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { BasicChannelTabsProps, ChannelTabsProps, clearStaleNavigationContext, closeTab, createTab, handleChannelSwitch, isNavigationFromSource, isTabSelected, jumpToUnreadTab, moveCurrentTab, moveToTab, openedTabs, openStartupTabs, saveTabs, settings, setUpdaterFunction, useGhostTabs } from "@equicordplugins/channelTabs/util";
import { IS_MAC } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { findComponentByCodeLazy } from "@webpack";
import { Button, ChannelRTCStore, ChannelStore, ContextMenuApi, FluxDispatcher, GuildStore, ReadStateStore, TextInput, Tooltip, useCallback, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import channelTabs from "..";
import { anyTabHasMention } from "../util/tabs";
import BookmarkContainer, { HorizontalScroller } from "./BookmarkContainer";
import ChannelTab, { PreviewTab } from "./ChannelTab";
import { BasicContextMenu } from "./ContextMenus";

type TabSet = Record<string, ChannelTabsProps[]>;

const PlusSmallIcon = findComponentByCodeLazy("0v-5h5a1");

const cl = classNameFactory("vc-channeltabs-");

/** a dm has no name of its own, so it is searched by who is in it */
function tabText(tab: ChannelTabsProps): string {
    const channel = ChannelStore.getChannel(tab.channelId);
    const parts: (string | null | undefined)[] = [channel?.name, GuildStore.getGuild(tab.guildId)?.name];

    for (const one of channel?.rawRecipients ?? []) parts.push(one.username, one.global_name);

    return parts.filter(Boolean).join(" ").toLowerCase();
}

export default function ChannelsTabsContainer(props: BasicChannelTabsProps) {
    const [userId, setUserId] = useState("");
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [tabsOverflow, setTabsOverflow] = useState(false);
    const {
        showBookmarkBar,
        widerTabsAndBookmarks,
        tabWidthScale,
        tabHeightScale,
        enableNumberKeySwitching,
        numberKeySwitchCount,
        enableCloseTabShortcut,
        enableNewTabShortcut,
        enableTabCycleShortcut,
        enableMoveTabShortcut,
        moveTabLeftKeybind,
        moveTabRightKeybind,
        autoHideTabBar,
        revealOnMention,
        enableUnreadJumpShortcut,
        unreadJumpKeybind,
        closeTabKeybind,
        newTabKeybind,
        cycleTabForwardKeybind,
        cycleTabBackwardKeybind,
        tabBarPosition,
        animationHover,
        animationSelection,
        animationDragDrop,
        animationEnterExit,
        animationIconPop,
        animationCloseRotation,
        animationPlusPulse,
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
        newTabButtonBehavior
    } = settings.use([
        "showBookmarkBar",
        "widerTabsAndBookmarks",
        "tabWidthScale",
        "tabHeightScale",
        "enableNumberKeySwitching",
        "numberKeySwitchCount",
        "enableCloseTabShortcut",
        "enableNewTabShortcut",
        "enableTabCycleShortcut",
        "enableMoveTabShortcut",
        "moveTabLeftKeybind",
        "moveTabRightKeybind",
        "autoHideTabBar",
        "revealOnMention",
        "enableUnreadJumpShortcut",
        "unreadJumpKeybind",
        "closeTabKeybind",
        "newTabKeybind",
        "cycleTabForwardKeybind",
        "cycleTabBackwardKeybind",
        "tabBarPosition",
        "animationHover",
        "animationSelection",
        "animationDragDrop",
        "animationEnterExit",
        "animationIconPop",
        "animationCloseRotation",
        "animationPlusPulse",
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
        "newTabButtonBehavior"
    ]);
    const GhostTabs = useGhostTabs();
    const isFullscreen = useStateFromStores([], () => ChannelRTCStore.isFullscreenInContext() ?? false);
    const hasMention = useStateFromStores([ReadStateStore], () => anyTabHasMention());

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
        const scroller = scrollerRef.current;
        if (!scroller) return;

        const checkOverflow = () => {
            if (!newTabButtonBehavior) {
                setTabsOverflow(true);
                return;
            }
            const overflow = scroller.scrollWidth > scroller.clientWidth;
            setTabsOverflow(overflow);
        };

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

            const ctrlPressed = event.ctrlKey || event.metaKey;
            const shiftPressed = event.shiftKey;
            const altPressed = event.altKey;
            const keyPressed = event.key.toLowerCase();

            // special handling for TAB key
            if (mainKey === "tab") {
                return hasCtrl === ctrlPressed && hasShift === shiftPressed && hasAlt === altPressed && keyPressed === "tab";
            }

            // special handling for SPACE
            if (mainKey === "space") {
                return hasCtrl === ctrlPressed && hasShift === shiftPressed && hasAlt === altPressed && keyPressed === " ";
            }

            return hasCtrl === ctrlPressed && hasShift === shiftPressed && hasAlt === altPressed && keyPressed === mainKey;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;

            // skip if typing in input fields
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable
            ) {
                return;
            }

            // 1. number key switching (1-9)
            if (enableNumberKeySwitching) {
                const keyNumber = parseInt(event.key, 10);
                if (!isNaN(keyNumber) && keyNumber >= 1 && keyNumber <= numberKeySwitchCount) {
                    const tabIndex = keyNumber - 1;
                    if (openedTabs[tabIndex]) {
                        event.preventDefault();
                        moveToTab(openedTabs[tabIndex].id);
                        return;
                    }
                }
            }

            // 2. move the current tab along the bar
            if (enableMoveTabShortcut && matchesKeybind(event, moveTabLeftKeybind)) {
                event.preventDefault();
                moveCurrentTab(-1);
                return;
            }

            if (enableMoveTabShortcut && matchesKeybind(event, moveTabRightKeybind)) {
                event.preventDefault();
                moveCurrentTab(1);
                return;
            }

            // 3. jump to the next unread tab (default: CTRL+SHIFT+U)
            if (enableUnreadJumpShortcut && matchesKeybind(event, unreadJumpKeybind)) {
                event.preventDefault();
                event.stopPropagation();
                jumpToUnreadTab();
                return;
            }

            // 3. close tab shortcut (default: CTRL+W)
            if (enableCloseTabShortcut && matchesKeybind(event, closeTabKeybind)) {
                event.preventDefault();
                const currentTab = openedTabs.find(t => isTabSelected(t.id));
                if (currentTab && openedTabs.length > 1) {
                    closeTab(currentTab.id);
                }
                return;
            }

            // 3. new tab shortcut (default: CTRL+T)
            if (enableNewTabShortcut && matchesKeybind(event, newTabKeybind)) {
                event.preventDefault();
                event.stopPropagation(); // prevent discord's quick switcher from seeing this
                createTab(props, true);
                return;
            }

            // 4. cycle tabs forward (default: CTRL+TAB)
            if (enableTabCycleShortcut && matchesKeybind(event, cycleTabForwardKeybind)) {
                event.preventDefault();
                event.stopPropagation(); // prevent discord's guild switcher from seeing this
                const currentIndex = openedTabs.findIndex(t => isTabSelected(t.id));
                if (currentIndex !== -1 && openedTabs.length > 1) {
                    const nextIndex = (currentIndex + 1) % openedTabs.length;
                    moveToTab(openedTabs[nextIndex].id);
                }
                return;
            }

            // 5. cycle tabs backward (default: CTRL+SHIFT+TAB)
            if (enableTabCycleShortcut && matchesKeybind(event, cycleTabBackwardKeybind)) {
                event.preventDefault();
                event.stopPropagation(); // prevent Discord's guild switcher from seeing this
                const currentIndex = openedTabs.findIndex(t => isTabSelected(t.id));
                if (currentIndex !== -1 && openedTabs.length > 1) {
                    const nextIndex = (currentIndex - 1 + openedTabs.length) % openedTabs.length;
                    moveToTab(openedTabs[nextIndex].id);
                }
                return;
            }
        };

        document.addEventListener("keydown", handleKeyDown, true);

        return () => {
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [
        enableNumberKeySwitching,
        numberKeySwitchCount,
        enableCloseTabShortcut,
        closeTabKeybind,
        enableNewTabShortcut,
        newTabKeybind,
        enableTabCycleShortcut,
        cycleTabForwardKeybind,
        cycleTabBackwardKeybind,
        enableUnreadJumpShortcut,
        unreadJumpKeybind,
        enableMoveTabShortcut,
        moveTabLeftKeybind,
        moveTabRightKeybind,
        props,
        openedTabs
    ]);

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

    const shouldFollowNewTabButton = newTabButtonBehavior && !tabsOverflow;
    const query = searchQuery.trim().toLowerCase();
    const searchActive = query.length > 0;

    const searchBox = (
        <div className={classes(cl("tab-search-shell"), isSearchOpen && cl("tab-search-shell-open"))}>
            <div className={cl("tab-search-field")}>
                <TextInput
                    inputRef={searchInputRef}
                    inputClassName={cl("tab-search-input")}
                    style={{ width: "100%" }}
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search tabs"
                    onBlur={() => {
                        if (!searchQuery.trim()) setIsSearchOpen(false);
                    }}
                    onKeyDown={e => {
                        if (e.key !== "Escape") return;
                        if (searchQuery.trim()) setSearchQuery("");
                        else setIsSearchOpen(false);
                    }}
                />
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

    const newTabButton = (
        <button
            onClick={() => createTab(props, true)}
            className={cl("button", "new-button", "hoverable")}
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
                !animationHover && cl("no-hover-animation"),
                !animationSelection && cl("no-selection-animation"),
                !animationDragDrop && cl("no-drag-animation"),
                !animationEnterExit && cl("no-enter-exit-animation"),
                !animationIconPop && cl("no-icon-pop-animation"),
                !animationCloseRotation && cl("no-close-rotation"),
                !animationPlusPulse && cl("no-plus-animation"),
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
                !compactAutoExpandOnHover && cl("no-compact-hover-expand")
            )}
            ref={ref}
            style={{ "--tab-width-scale": tabWidthScale / 100, "--tab-height-scale": tabHeightScale / 100 } as React.CSSProperties}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <BasicContextMenu />)}
        >
            {showBookmarkBar && <>
                <BookmarkContainer {...props} userId={userId} />
                <div className={cl("separator")} />
            </>}
            <div className={cl("tab-container")}>
                <HorizontalScroller
                    customRef={node => { scrollerRef.current = node; }}
                    className={cl("tab-scroller", shouldFollowNewTabButton && "tab-scroller-following")}
                >
                    {openedTabs
                        .map((tab, i) => ({ tab, i }))
                        .filter(({ tab }) => tab != null && (!searchActive || tabText(tab).includes(query)))
                        .map(({ tab, i }) =>
                            <ChannelTab {...tab} index={i} key={tab.id} searchActive={searchActive} />
                        )}
                    {GhostTabs}
                    {shouldFollowNewTabButton && newTabButton}
                </HorizontalScroller>

                {!shouldFollowNewTabButton && newTabButton}
                {searchBox}
            </div >

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
