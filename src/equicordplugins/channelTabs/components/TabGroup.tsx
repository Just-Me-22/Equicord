/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { ChannelTabsProps, getGroupActiveTab, groupLabel, groupTabs, isTabSelected, moveToTab, removeFromGroup, settings, TabGroup as TabGroupType, toggleGroupCollapsed } from "@equicordplugins/channelTabs/util";
import { classNameFactory } from "@utils/css";
import { ChannelStore, ContextMenuApi, GuildStore, ReadStateStore, useDrag, useDrop, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

import ChannelTab, { GuildIcon, NotificationDot } from "./ChannelTab";
import { GroupContextMenu } from "./ContextMenus";

const cl = classNameFactory("vc-channeltabs-");

function ChevronIcon() {
    return <svg width={16} height={16} viewBox="0 0 24 24" className={cl("group-chevron-icon")}>
        <path fill="var(--interactive-icon-default)" d="M9.3 5.3a1 1 0 0 0 0 1.4l5.3 5.3-5.3 5.3a1 1 0 1 0 1.4 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.4 0Z" />
    </svg>;
}

function tabLabel(tab: ChannelTabsProps, group: TabGroupType) {
    return ChannelStore.getChannel(tab.channelId)?.name || groupLabel(group);
}

export default function TabGroup({ group, tabs, index }: { group: TabGroupType; tabs: ChannelTabsProps[]; index: number; }) {
    const { groupHoverMenu } = settings.use(["groupHoverMenu"]);
    const headerRef = useRef<HTMLDivElement>(null);
    const activeTab = useStateFromStores([ReadStateStore], () => getGroupActiveTab(group.id));

    // the tab scroller sets overflow-x, which forces overflow-y to compute as auto and
    // clips anything drawn above the bar. fixed coordinates taken from the header put
    // the list outside that scroller entirely.
    const [flyoutAt, setFlyoutAt] = useState<React.CSSProperties | null>(null);
    const hoverTimer = useRef<NodeJS.Timeout | undefined>(undefined);
    useEffect(() => () => clearTimeout(hoverTimer.current), []);

    const openFlyout = () => {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
            const rect = headerRef.current?.getBoundingClientRect();
            if (!rect) return;

            const above = rect.top > window.innerHeight / 2;
            setFlyoutAt({
                left: rect.left,
                ...(above
                    ? { bottom: window.innerHeight - rect.top + 6 }
                    : { top: rect.bottom + 6 })
            });
        }, 250);
    };
    const closeFlyout = () => {
        clearTimeout(hoverTimer.current);
        setFlyoutAt(null);
    };
    const guild = GuildStore.getGuild(activeTab.guildId);
    const label = tabLabel(activeTab, group);
    const showFlyout = groupHoverMenu && group.collapsed && flyoutAt;

    const [, drag] = useDrag(() => ({
        type: "vc_ChannelTab",
        item: () => ({ id: -1, groupId: group.id })
    }), [group.id]);
    const [{ isOver }, drop] = useDrop(() => ({
        accept: "vc_ChannelTab",
        collect: monitor => ({ isOver: monitor.isOver() && !(monitor.getItem() as { groupId?: string; } | null)?.groupId }),
        drop: (item: { id: number; groupId?: string; }) => {
            if (item.groupId) return;
            if (tabs.some(tab => tab.id === item.id)) return removeFromGroup(item.id, true);
            groupTabs(item.id, getGroupActiveTab(group.id).id);
        }
    }), [group.id, tabs]);
    drag(drop(headerRef));

    return <div
        className={cl("group", {
            "group-expanded": !group.collapsed,
            "group-selected": group.collapsed && tabs.some(tab => isTabSelected(tab.id)),
            "group-drop-target": isOver
        })}
        onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <GroupContextMenu group={group} />)}
        onMouseEnter={openFlyout}
        onMouseLeave={closeFlyout}
    >
        <div className={cl("group-head")} ref={headerRef}>
            <button
                className={cl("button", "group-chevron", "hoverable")}
                aria-label={group.collapsed ? "Expand tab group" : "Collapse tab group"}
                onClick={() => toggleGroupCollapsed(group.id)}
            >
                <ChevronIcon />
            </button>
            {group.collapsed && <button
                className={cl("button", "group-label")}
                onClick={() => moveToTab(getGroupActiveTab(group.id).id)}
            >
                {guild && <GuildIcon guild={guild} />}
                <BaseText className={cl("name-text")}>{label}</BaseText>
                <span className={cl("group-count")}>{tabs.length}</span>
                <NotificationDot channelIds={tabs.map(tab => tab.channelId)} />
            </button>}
        </div>

        <div className={cl("group-members")}>
            <div className={cl("group-members-inner")}>
                {tabs.map((tab, i) => <ChannelTab {...tab} index={index + i} key={tab.id} />)}
            </div>
        </div>

        {showFlyout && <div className={cl("group-flyout")} style={flyoutAt}>
            {tabs.map(tab => <button
                key={tab.id}
                className={cl("button", "group-flyout-item", { "group-flyout-item-selected": isTabSelected(tab.id) })}
                onClick={() => {
                    closeFlyout();
                    moveToTab(tab.id);
                }}
            >
                <BaseText className={cl("name-text")}>{tabLabel(tab, group)}</BaseText>
                <NotificationDot channelIds={[tab.channelId]} />
            </button>)}
        </div>}
    </div>;
}
