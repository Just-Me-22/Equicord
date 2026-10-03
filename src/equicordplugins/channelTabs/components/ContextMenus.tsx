/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Heading } from "@components/Heading";
import { BookCheckIcon, OpenExternalIcon, PencilIcon, StarFilled, StarOutlined, TrashIcon, UnsendIcon, WindowTopOutlineIcon, XLargeBoldIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { bookmarkFolderColors, bookmarkPlaceholderName, closeGroup, closeOtherTabs, closeTabAnimated, closeTabsToTheLeft, closeTabsToTheRight, createTab, deleteTabSet, duplicateTab, getDiscordFolderIcon, getDiscordFolderIconNames, groupLabel, hasClosedTabs, isBookmarkFolder, isTabSelected, moveToTab, openedTabs, openTabSet, recentlyClosedTabs, removeFromGroup, renameGroup, renameTab, reopenClosedTab, reopenClosedTabAt, saveTabSet, setGroupColor, settings, tabSetNames, tabTitle, tintColors, toggleCompactTab, toggleGroupCollapsed, togglePin, ungroup } from "@equicordplugins/channelTabs/util";
import { Bookmark, BookmarkFolder, Bookmarks, ChannelTabsProps, TabGroup, UseBookmarkMethods } from "@equicordplugins/channelTabs/util/types";
import { getIntlMessage } from "@utils/discord";
import { Margins } from "@utils/margins";
import { RenderModalProps } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelStore, closeModal, ColorPicker, FluxDispatcher, Menu, Modal, openModal, ReadStateStore, ReadStateUtils, Select, showToast, TextInput, Toasts, useMemo, UserGuildSettingsStore, useState } from "@webpack/common";

const { updateChannelOverrideSettings } = findByPropsLazy("updateChannelOverrideSettings");

const MUTE_FOR: [string, number][] = [
    ["For 15 Minutes", 900],
    ["For 1 Hour", 3600],
    ["For 3 Hours", 10800],
    ["For 8 Hours", 28800],
    ["For 24 Hours", 86400],
    ["Until I turn it back on", -1]
];

const NOTIFY_LEVELS: [string, number][] = [
    ["Use Category Default", 3],
    ["All Messages", 0],
    ["Only @mentions", 1],
    ["Nothing", 2]
];

function markAllTabsRead() {
    FluxDispatcher.dispatch({
        type: "BULK_ACK",
        context: "APP",
        channels: openedTabs
            .filter(tab => ReadStateStore.hasUnread(tab.channelId))
            .map(tab => ({ channelId: tab.channelId, messageId: ReadStateStore.lastMessageId(tab.channelId), readStateType: 0 }))
    });
}

function askForName({ title, heading, initial, placeholder, onSave }: {
    title: string;
    heading: string;
    initial: string;
    placeholder: string;
    onSave: (name: string) => void;
}) {
    const key = openModal(modalProps =>
        <NameModal
            modalProps={modalProps}
            title={title}
            heading={heading}
            initial={initial}
            placeholder={placeholder}
            onSave={name => {
                onSave(name.trim());
                closeModal(key);
            }}
            onCancel={() => closeModal(key)}
        />
    );
}

/** discord does not export a pin icon, and matching one out of webpack by its path data
 *  breaks on their next build, so this is drawn here */
const PinIcon = (props: { width?: number; height?: number; className?: string; }) => (
    <svg
        width={props.width ?? 18}
        height={props.height ?? 18}
        className={props.className}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
    >
        <path d="M10 3h4v6l3 3v2h-4v7h-2v-7H7v-2l3-3V3Z" />
    </svg>
);

const legacyFolderColors: Record<string, string> = {
    "var(--channeltabs-red)": bookmarkFolderColors.Red,
    "var(--channeltabs-blue)": bookmarkFolderColors.Blue,
    "var(--channeltabs-yellow)": bookmarkFolderColors.Yellow,
    "var(--channeltabs-green)": bookmarkFolderColors.Green,
    "var(--channeltabs-black)": bookmarkFolderColors.Black,
    "var(--channeltabs-white)": bookmarkFolderColors.White,
    "var(--channeltabs-orange)": bookmarkFolderColors.Orange,
    "var(--channeltabs-pink)": bookmarkFolderColors.Pink
};

const normalizeFolderColor = (color?: string) => {
    if (!color) return bookmarkFolderColors.Black;
    return legacyFolderColors[color] ?? color;
};

const colorToInt = (color?: string) => {
    const normalized = normalizeFolderColor(color);
    if (!/^#([0-9a-f]{6})$/i.test(normalized)) return parseInt(bookmarkFolderColors.Black.slice(1), 16);
    return parseInt(normalized.slice(1), 16);
};

const intToColor = (value: number | null) =>
    value == null
        ? bookmarkFolderColors.Black
        : `#${value.toString(16).padStart(6, "0")}`;

export function AllTabsMenu() {
    return (
        <Menu.Menu
            navId="channeltabs-all-tabs"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="All Tabs"
        >
            <Menu.MenuGroup>
                {openedTabs.map(tab => (
                    <Menu.MenuRadioItem
                        key={tab.id}
                        id={`all-tabs-${tab.id}`}
                        group="channeltabs-all-tabs"
                        label={tabTitle(tab)}
                        checked={isTabSelected(tab.id)}
                        action={() => moveToTab(tab.id)}
                    />
                ))}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export function BasicContextMenu() {
    const { showBookmarkBar } = settings.use(["showBookmarkBar", "tabSets"]);
    const sets = tabSetNames();

    return (
        <Menu.Menu
            navId="channeltabs-context"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="ChannelTabs Context Menu"
        >
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="mark-all-tabs-read"
                    label="Mark All Tabs Read"
                    disabled={!openedTabs.some(tab => ReadStateStore.hasUnread(tab.channelId))}
                    action={markAllTabsRead}
                />
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="save-tab-set"
                    label="Save Tab Set"
                    action={() => askForName({
                        title: "Save Tab Set",
                        heading: "Name",
                        initial: "",
                        placeholder: `Set ${sets.length + 1}`,
                        onSave: name => {
                            saveTabSet(name || `Set ${sets.length + 1}`);
                            showToast("Tab set saved", Toasts.Type.SUCCESS);
                        }
                    })}
                />
                <Menu.MenuItem id="tab-sets" label="Tab Sets" disabled={!sets.length}>
                    {sets.map(name => (
                        <Menu.MenuItem key={name} id={`tab-set-${name}`} label={name} action={() => openTabSet(name)}>
                            <Menu.MenuItem id={`tab-set-${name}-open`} label="Open" action={() => openTabSet(name)} />
                            <Menu.MenuItem id={`tab-set-${name}-update`} label="Replace With Open Tabs" action={() => saveTabSet(name)} />
                            <Menu.MenuItem id={`tab-set-${name}-delete`} label="Delete" color="danger" action={() => deleteTabSet(name)} />
                        </Menu.MenuItem>
                    ))}
                </Menu.MenuItem>
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem
                    checked={showBookmarkBar}
                    id="show-bookmark-bar"
                    label="Bookmark Bar"
                    action={() => {
                        settings.store.showBookmarkBar = !settings.store.showBookmarkBar;
                    }}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function FolderGlyph({ color, iconName }: { color: string; iconName?: string; }) {
    const IconComponent = getDiscordFolderIcon(iconName);
    const resolvedColor = normalizeFolderColor(color);
    const fill = iconName === "CircleShieldIcon" ? "var(--background-base-low)" : resolvedColor;
    const customIconSize = 16;

    return (
        <div style={{
            alignItems: "center",
            color: resolvedColor,
            display: "flex",
            justifyContent: "center",
            lineHeight: 0
        }}>
            {IconComponent
                ? <IconComponent
                    height={customIconSize}
                    width={customIconSize}
                    color={resolvedColor}
                    fill={fill}
                    style={{ transform: "scale(0.6666667)", transformOrigin: "center" }}
                />
                : <svg height={16} width={16} viewBox="0 0 24 24">
                    <path
                        fill="currentColor"
                        d="M20 7H12L10.553 5.106C10.214 4.428 9.521 4 8.764 4H3C2.447 4 2 4.447 2 5V19C2 20.104 2.895 21 4 21H20C21.104 21 22 20.104 22 19V9C22 7.896 21.104 7 20 7Z"
                    />
                </svg>}
        </div>
    );
}

function FolderChipPreview({ name, color, iconName }: { name: string; color: string; iconName?: string; }) {
    return (
        <div style={{
            alignItems: "center",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            display: "inline-flex",
            gap: 8,
            marginTop: 12,
            maxWidth: "100%",
            padding: "6px 10px"
        }}>
            <FolderGlyph color={color} iconName={iconName} />
            <BaseText size="sm">{name.trim() || "Folder"}</BaseText>
        </div>
    );
}

function FolderIconPickerModal({ modalProps, modalKey, name, color, iconName, onSelect, onColorChange }: {
    modalProps: RenderModalProps,
    modalKey: string,
    name: string,
    color: string,
    iconName?: string,
    onSelect: (iconName: string) => void,
    onColorChange: (color: string) => void;
}) {
    const [search, setSearch] = useState("");
    const [localColor, setLocalColor] = useState(normalizeFolderColor(color));
    const iconNames = useMemo(() => getDiscordFolderIconNames(), []);
    const filteredIconNames = useMemo(() => {
        const normalized = search.trim().toLowerCase();
        if (!normalized) return iconNames;
        return iconNames.filter(iconName => iconName.toLowerCase().includes(normalized));
    }, [iconNames, search]);

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={<BaseText size="lg" weight="semibold">Choose Folder Icon</BaseText>}
            actions={[
                {
                    text: "Close",
                    variant: "secondary",
                    onClick: () => closeModal(modalKey)
                }
            ]}
        >
            <Heading className={Margins.top16}>Preview</Heading>
            <FolderChipPreview name={name} color={localColor} iconName={iconName} />
            <Heading className={Margins.top16}>Icon Color</Heading>
            <div className={Margins.top8}>
                <ColorPicker
                    color={colorToInt(localColor)}
                    onChange={value => {
                        const nextColor = intToColor(value);
                        setLocalColor(nextColor);
                        onColorChange(nextColor);
                    }}
                    showEyeDropper={false}
                />
            </div>
            <Heading className={Margins.top16}>Search</Heading>
            <TextInput
                value={search}
                placeholder={`Search ${iconNames.length} icons...`}
                onChange={setSearch}
            />
            <div style={{
                display: "grid",
                gap: 8,
                gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
                marginTop: 16,
                maxHeight: 320,
                overflowY: "auto"
            }}>
                {filteredIconNames.map(name => (
                    <button
                        key={name}
                        onClick={() => {
                            onSelect(name);
                            closeModal(modalKey);
                        }}
                        style={{
                            alignItems: "center",
                            background: name === iconName ? "var(--background-modifier-hover)" : "var(--background-secondary)",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 8,
                            cursor: "pointer",
                            display: "flex",
                            height: 52,
                            justifyContent: "center",
                            padding: 0
                        }}
                        title={name}
                        type="button"
                    >
                        <FolderGlyph color={localColor} iconName={name} />
                    </button>
                ))}
            </div>
        </Modal>
    );
}

function FolderAppearanceFields({
    name,
    setName,
    color,
    setColor,
    iconName,
    setIconName,
    placeholder = "Folder"
}: {
    name: string,
    setName: (value: string) => void,
    color: string,
    setColor: (value: string) => void,
    iconName?: string,
    setIconName: (value?: string) => void,
    placeholder?: string;
}) {
    return <>
        <Heading className={Margins.top16}>Folder Name</Heading>
        <TextInput
            value={name === placeholder ? undefined : name}
            placeholder={placeholder}
            onChange={setName}
        />
        <Heading className={Margins.top16}>Folder Color</Heading>
        <div className={Margins.top8}>
            <ColorPicker
                color={colorToInt(color)}
                onChange={value => setColor(intToColor(value))}
                showEyeDropper={false}
            />
        </div>
        <Heading className={Margins.top16}>Folder Icon</Heading>
        <FolderChipPreview name={name} color={color} iconName={iconName} />
        <Button
            className={Margins.top8}
            onClick={() => {
                const key = openModal(modalProps => (
                    <FolderIconPickerModal
                        modalProps={modalProps}
                        modalKey={key}
                        name={name}
                        color={color}
                        iconName={iconName}
                        onSelect={setIconName}
                        onColorChange={setColor}
                    />
                ));
            }}
        >Choose Icon</Button>
        {iconName && <Button
            className={Margins.top8}
            color={Button.Colors.TRANSPARENT}
            look={Button.Looks.FILLED}
            onClick={() => setIconName(undefined)}
        >Use Default Icon</Button>}
    </>;
}

export function EditModal({ modalProps, modalKey, bookmark, onSave }: {
    modalProps: RenderModalProps,
    modalKey: string,
    bookmark: Bookmark | BookmarkFolder,
    onSave: (name: string, color: string, iconName?: string) => void;
}) {
    const [name, setName] = useState(bookmark.name);
    const [color, setColor] = useState(isBookmarkFolder(bookmark) ? normalizeFolderColor(bookmark.iconColor) : bookmarkFolderColors.Black);
    const [iconName, setIconName] = useState(isBookmarkFolder(bookmark) ? bookmark.iconName : undefined);
    const placeholder = bookmarkPlaceholderName(bookmark);

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={<BaseText size="lg" weight="semibold">Edit Bookmark</BaseText>}
            actions={[
                {
                    text: "Save",
                    variant: "primary",
                    onClick: () => onSave(name || placeholder, color, iconName)
                },
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: () => closeModal(modalKey)
                }
            ]}
        >
            {isBookmarkFolder(bookmark)
                ? <FolderAppearanceFields
                    name={name}
                    setName={setName}
                    color={color}
                    setColor={setColor}
                    iconName={iconName}
                    setIconName={setIconName}
                    placeholder={placeholder}
                />
                : <>
                    <Heading className={Margins.top16}>Bookmark Name</Heading>
                    <TextInput
                        value={name === placeholder ? undefined : name}
                        placeholder={placeholder}
                        onChange={setName}
                    />
                </>}
        </Modal>
    );
}

function AddToFolderModal({ modalProps, modalKey, bookmarks, onSave }: {
    modalProps: RenderModalProps,
    modalKey: string,
    bookmarks: Bookmarks,
    onSave: (folderIndex: number, folderName: string, folderColor: string, iconName?: string) => void;
}) {
    const [folderIndex, setIndex] = useState(-1);
    const [folderName, setFolderName] = useState("");
    const [folderColor, setFolderColor] = useState<string>(bookmarkFolderColors.Black);
    const [iconName, setIconName] = useState<string | undefined>();

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={<BaseText size="lg" weight="semibold">Add Bookmark to Folder</BaseText>}
            actions={[
                {
                    text: "Save",
                    variant: "primary",
                    onClick: () => onSave(folderIndex, folderName, folderColor, iconName)
                },
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: () => closeModal(modalKey)
                }
            ]}
        >
            <Heading className={Margins.top16}>Select a folder</Heading>
            <Select
                options={[...Object.entries(bookmarks)
                    .filter(([, bookmark]) => isBookmarkFolder(bookmark))
                    .map(([index, bookmark]) => ({
                        label: bookmark.name,
                        value: parseInt(index, 10)
                    })),
                {
                    label: "Create one",
                    value: -1,
                    default: true
                }]}
                isSelected={v => v === folderIndex}
                select={setIndex}
                serialize={String}
            />
            {folderIndex === -1 && <FolderAppearanceFields
                name={folderName}
                setName={setFolderName}
                color={folderColor}
                setColor={setFolderColor}
                iconName={iconName}
                setIconName={setIconName}
            />}
        </Modal>
    );
}

function DeleteFolderConfirmationModal({ modalProps, modalKey, onConfirm }: {
    modalProps: RenderModalProps,
    modalKey: string,
    onConfirm: () => void;
}) {
    return (
        <Modal
            {...modalProps}
            size="sm"
            title={<BaseText size="lg" weight="semibold">Are you sure?</BaseText>}
            actions={[
                {
                    text: "Delete",
                    variant: "critical-primary",
                    onClick: onConfirm
                },
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: () => closeModal(modalKey)
                }
            ]}
        >
            <Paragraph className={Margins.top16}>
                Deleting a bookmark folder will also delete all bookmarks within it.
            </Paragraph>
        </Modal>
    );
}

export function BookmarkContextMenu({ bookmarks, index, methods }: { bookmarks: Bookmarks, index: number, methods: UseBookmarkMethods; }) {
    const { showBookmarkBar, bookmarkNotificationDot } = settings.use(["showBookmarkBar", "bookmarkNotificationDot"]);
    const bookmark = bookmarks[index];
    const isFolder = isBookmarkFolder(bookmark);

    return (
        <Menu.Menu
            navId="channeltabs-bookmark-context"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="ChannelTabs Bookmark Context Menu"
        >
            <Menu.MenuGroup>
                {bookmarkNotificationDot && !isFolder &&
                    <Menu.MenuItem
                        id="mark-as-read"
                        icon={BookCheckIcon}
                        leadingAccessory={{ type: "icon", icon: BookCheckIcon }}
                        label={getIntlMessage("MARK_AS_READ")}
                        disabled={!ReadStateStore.hasUnread(bookmark.channelId)}
                        action={() => ReadStateUtils.ackChannel(ChannelStore.getChannel(bookmark.channelId))}
                    />
                }
                {isFolder
                    ? <Menu.MenuItem
                        id="open-all-in-folder"
                        label={"Open All Bookmarks"}
                        icon={StarFilled}
                        leadingAccessory={{ type: "icon", icon: StarFilled }}
                        action={() => bookmark.bookmarks.forEach(b => createTab(b))}
                    />
                    : < Menu.MenuItem
                        id="open-in-tab"
                        label={"Open in New Tab"}
                        icon={OpenExternalIcon}
                        leadingAccessory={{ type: "icon", icon: OpenExternalIcon }}
                        action={() => createTab(bookmark)}
                    />
                }
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="edit-bookmark"
                    label="Edit Bookmark"
                    icon={PencilIcon}
                    leadingAccessory={{ type: "icon", icon: PencilIcon }}
                    action={() => {
                        const key = openModal(modalProps =>
                            <EditModal
                                modalProps={modalProps}
                                modalKey={key}
                                bookmark={bookmark}
                                onSave={(name, color, iconName) => {
                                    methods.editBookmark(index, {
                                        name,
                                        ...(isFolder && { iconColor: normalizeFolderColor(color), iconName })
                                    });
                                    closeModal(key);
                                }
                                }
                            />
                        );
                    }}
                />
                <Menu.MenuItem
                    id="delete-bookmark"
                    label="Delete Bookmark"
                    icon={TrashIcon}
                    leadingAccessory={{ type: "icon", icon: TrashIcon }}
                    action={() => {
                        if (isFolder) {
                            const key = openModal(modalProps =>
                                <DeleteFolderConfirmationModal
                                    modalProps={modalProps}
                                    modalKey={key}
                                    onConfirm={() => {
                                        methods.deleteBookmark(index);
                                        closeModal(key);
                                    }}
                                />);
                        }
                        else methods.deleteBookmark(index);
                    }}
                />
                <Menu.MenuItem
                    id="add-to-folder"
                    label="Add Bookmark to Folder"
                    icon={PencilIcon}
                    leadingAccessory={{ type: "icon", icon: PencilIcon }}
                    disabled={isFolder}
                    action={() => {
                        const key = openModal(modalProps =>
                            <AddToFolderModal
                                modalProps={modalProps}
                                modalKey={key}
                                bookmarks={bookmarks}
                                onSave={(index, folderName, folderColor, iconName) => {
                                    if (index === -1) {
                                        const folderIndex = methods.addFolder(folderName, normalizeFolderColor(folderColor), iconName);
                                        methods.addBookmark(bookmark as Bookmark, folderIndex);
                                    }
                                    else methods.addBookmark(bookmark as Bookmark, index);
                                    methods.deleteBookmark(bookmarks.indexOf(bookmark));
                                    closeModal(key);
                                }
                                }
                            />
                        );
                    }}
                />
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem
                    checked={showBookmarkBar}
                    id="show-bookmark-bar"
                    label="Bookmark Bar"
                    icon={StarOutlined}
                    leadingAccessory={{ type: "icon", icon: StarOutlined }}
                    action={() => {
                        settings.store.showBookmarkBar = !settings.store.showBookmarkBar;
                    }}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export function TabContextMenu({ tab }: { tab: ChannelTabsProps; }) {
    const channel = ChannelStore.getChannel(tab.channelId);
    const [compact, setCompact] = useState(tab.compact);
    const { showBookmarkBar } = settings.use(["showBookmarkBar"]);
    const guildId = channel?.guild_id ?? null;
    const muted = !!channel && UserGuildSettingsStore.isChannelMuted(guildId, channel.id);
    const notifyLevel = guildId && channel
        ? UserGuildSettingsStore.getChannelOverrides(guildId)?.[channel.id]?.message_notifications ?? 3
        : undefined;

    return (
        <Menu.Menu
            navId="channeltabs-tab-context"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="ChannelTabs Tab Context Menu"
        >
            <Menu.MenuGroup>
                {channel &&
                    <Menu.MenuItem
                        id="mark-as-read"
                        label={getIntlMessage("MARK_AS_READ")}
                        icon={BookCheckIcon}
                        leadingAccessory={{ type: "icon", icon: BookCheckIcon }}
                        disabled={!ReadStateStore.hasUnread(channel.id)}
                        action={() => ReadStateUtils.ackChannel(channel)}
                    />
                }
                <Menu.MenuCheckboxItem
                    checked={!!tab.pinned}
                    id="toggle-pin-tab"
                    label="Pin Tab"
                    icon={PinIcon}
                    leadingAccessory={{ type: "icon", icon: PinIcon }}
                    action={() => togglePin(tab.id)}
                />
                <Menu.MenuCheckboxItem
                    checked={compact}
                    id="toggle-compact-tab"
                    label="Compact"
                    icon={WindowTopOutlineIcon}
                    leadingAccessory={{ type: "icon", icon: WindowTopOutlineIcon }}
                    action={() => {
                        setCompact(compact => !compact);
                        toggleCompactTab(tab.id);
                    }}
                />
                <Menu.MenuItem
                    id="rename-tab"
                    label="Rename Tab"
                    icon={PencilIcon}
                    leadingAccessory={{ type: "icon", icon: PencilIcon }}
                    action={() => askForName({
                        title: "Rename Tab",
                        heading: "Tab Name",
                        initial: tab.label ?? "",
                        placeholder: tabTitle({ ...tab, label: undefined }),
                        onSave: name => renameTab(tab.id, name)
                    })}
                />
                {tab.groupId && <Menu.MenuItem
                    id="remove-from-group"
                    label="Remove from Group"
                    action={() => removeFromGroup(tab.id, true)}
                />}
            </Menu.MenuGroup>
            {channel && <Menu.MenuGroup>
                {muted
                    ? <Menu.MenuItem
                        id="unmute-channel"
                        label="Unmute Channel"
                        action={() => updateChannelOverrideSettings(guildId, channel.id, { muted: false })}
                    />
                    : <Menu.MenuItem id="mute-channel" label="Mute Channel">
                        {MUTE_FOR.map(([label, seconds]) => (
                            <Menu.MenuItem
                                key={seconds}
                                id={`mute-channel-${seconds}`}
                                label={label}
                                action={() => updateChannelOverrideSettings(guildId, channel.id, {
                                    muted: true,
                                    mute_config: {
                                        selected_time_window: seconds,
                                        end_time: seconds === -1 ? null : new Date(Date.now() + seconds * 1000).toISOString()
                                    }
                                })}
                            />
                        ))}
                    </Menu.MenuItem>}
                {notifyLevel !== undefined && <Menu.MenuItem id="notification-settings" label="Notification Settings">
                    {NOTIFY_LEVELS.map(([label, level]) => (
                        <Menu.MenuRadioItem
                            key={level}
                            id={`notify-${level}`}
                            group="channeltabs-notify"
                            label={label}
                            checked={notifyLevel === level}
                            action={() => updateChannelOverrideSettings(guildId, channel.id, { message_notifications: level })}
                        />
                    ))}
                </Menu.MenuItem>}
            </Menu.MenuGroup>}
            {openedTabs.length !== 1 && <Menu.MenuGroup>
                <Menu.MenuItem
                    id="close-tab"
                    label="Close Tab"
                    icon={XLargeBoldIcon}
                    leadingAccessory={{ type: "icon", icon: XLargeBoldIcon }}
                    action={() => closeTabAnimated(tab.id)}
                />
                <Menu.MenuItem
                    id="duplicate-tab"
                    label="Duplicate Tab"
                    icon={OpenExternalIcon}
                    leadingAccessory={{ type: "icon", icon: OpenExternalIcon }}
                    action={() => duplicateTab(tab.id)}
                />
                <Menu.MenuItem
                    id="close-other-tabs"
                    label="Close Other Tabs"
                    icon={XLargeBoldIcon}
                    leadingAccessory={{ type: "icon", icon: XLargeBoldIcon }}
                    action={() => closeOtherTabs(tab.id)}
                />
                <Menu.MenuItem
                    id="close-right-tabs"
                    label="Close Tabs to the Right"
                    icon={XLargeBoldIcon}
                    leadingAccessory={{ type: "icon", icon: XLargeBoldIcon }}
                    disabled={openedTabs.indexOf(tab) === openedTabs.length - 1}
                    action={() => closeTabsToTheRight(tab.id)}
                />
                <Menu.MenuItem
                    id="close-left-tabs"
                    label="Close Tabs to the Left"
                    icon={XLargeBoldIcon}
                    leadingAccessory={{ type: "icon", icon: XLargeBoldIcon }}
                    disabled={openedTabs.indexOf(tab) === 0}
                    action={() => closeTabsToTheLeft(tab.id)}
                />
                <Menu.MenuItem
                    id="reopen-closed-tab"
                    label="Reopen Closed Tab"
                    icon={UnsendIcon}
                    leadingAccessory={{ type: "icon", icon: UnsendIcon }}
                    disabled={!hasClosedTabs()}
                    action={() => reopenClosedTab()}
                >
                    {recentlyClosedTabs().slice(0, 10).map((closed, i) => (
                        <Menu.MenuItem
                            key={`${closed.channelId}-${i}`}
                            id={`reopen-closed-tab-${i}`}
                            label={ChannelStore.getChannel(closed.channelId)?.name || "Unknown channel"}
                            action={() => reopenClosedTabAt(i)}
                        />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuGroup>}
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem
                    checked={showBookmarkBar}
                    id="show-bookmark-bar"
                    label="Bookmark Bar"
                    icon={StarOutlined}
                    leadingAccessory={{ type: "icon", icon: StarOutlined }}
                    action={() => {
                        settings.store.showBookmarkBar = !settings.store.showBookmarkBar;
                    }}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function NameModal({ modalProps, title, heading, initial, placeholder, onSave, onCancel }: {
    modalProps: RenderModalProps,
    title: string,
    heading: string,
    initial: string,
    placeholder: string,
    onSave: (name: string) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(initial);

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={<BaseText size="lg" weight="semibold">{title}</BaseText>}
            actions={[
                {
                    text: "Save",
                    variant: "primary",
                    onClick: () => onSave(name)
                },
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: onCancel
                }
            ]}
        >
            <Heading className={Margins.top16}>{heading}</Heading>
            <TextInput
                value={name}
                placeholder={placeholder}
                onChange={setName}
                onKeyDown={e => {
                    if (e.key === "Enter") onSave(name);
                }}
            />
        </Modal>
    );
}

export function GroupContextMenu({ group }: { group: TabGroup; }) {
    return (
        <Menu.Menu
            navId="channeltabs-group-context"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="ChannelTabs Group Context Menu"
        >
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="toggle-group"
                    label={group.collapsed ? "Expand Group" : "Collapse Group"}
                    action={() => toggleGroupCollapsed(group.id)}
                />
                <Menu.MenuItem
                    id="rename-group"
                    label="Rename Group"
                    action={() => askForName({
                        title: "Rename Group",
                        heading: "Group Name",
                        initial: group.name ?? "",
                        placeholder: groupLabel({ ...group, name: undefined }),
                        onSave: name => renameGroup(group.id, name)
                    })}
                />
                <Menu.MenuItem id="group-colour" label="Colour">
                    {[["None", undefined] as const, ...tintColors].map(([name, hex]) => (
                        <Menu.MenuRadioItem
                            key={name}
                            id={`group-colour-${name}`}
                            group="channeltabs-group-colour"
                            label={name}
                            checked={group.color === hex}
                            action={() => setGroupColor(group.id, hex)}
                        />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="ungroup"
                    label="Ungroup"
                    action={() => ungroup(group.id)}
                />
                <Menu.MenuItem
                    id="close-group"
                    label="Close Group"
                    action={() => closeGroup(group.id)}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}
