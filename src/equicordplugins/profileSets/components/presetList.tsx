/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { openModal, React, showToast, TextInput, Toasts } from "@webpack/common";

import { cl } from "..";
import { deletePreset, movePreset, renamePreset, sendPreset, updatePresetFields } from "../utils/actions";
import { getCurrentProfile } from "../utils/profile";
import { PresetSection, type ProfilePresetEx } from "../utils/storage";
import { DetailsModal } from "./detailsModal";

interface PresetListProps {
    presets: ProfilePresetEx[];
    allPresets: ProfilePresetEx[];
    avatarSize: number;
    selectedPreset: number;
    onLoad: (index: number) => void;
    onUpdate: () => void;
    guildId?: string;
    section: PresetSection;
    currentPage: number;
    onPageChange: (page: number) => void;
}

const DOTS = "M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z";

export function PresetList({
    presets,
    allPresets,
    avatarSize,
    selectedPreset,
    onLoad,
    onUpdate,
    guildId,
    section,
    currentPage,
    onPageChange
}: PresetListProps) {
    const [renaming, setRenaming] = React.useState<number>(-1);
    const [renameText, setRenameText] = React.useState("");
    const [openMenu, setOpenMenu] = React.useState<number>(-1);
    const [busy, setBusy] = React.useState<number>(-1);
    const isGuildProfile = section === "server";
    const other = isGuildProfile ? "your main profile" : "server profiles";

    // a plain element rather than discord's context menu because this list also renders
    // inside the profile card, whose focus lock closes a context menu as it opens.
    React.useEffect(() => {
        if (openMenu === -1) return;
        const close = () => setOpenMenu(-1);
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [openMenu]);

    return (
        <div className={cl("list-container")}>
            {presets.map(preset => {
                const actualIndex = allPresets.indexOf(preset);
                const isRenaming = renaming === actualIndex;
                const isSelected = !isRenaming && selectedPreset === actualIndex;
                const date = new Date(preset.timestamp);
                const formattedDate = date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                });
                const formattedTime = date.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit"
                });

                const commitRename = () => {
                    const nextName = renameText.trim();
                    if (!nextName) return;
                    renamePreset(actualIndex, nextName, section, guildId);
                    onUpdate();
                };

                const act = (fn: () => void) => (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setOpenMenu(-1);
                    fn();
                };

                return (
                    <div
                        key={actualIndex}
                        tabIndex={isRenaming ? -1 : 0}
                        role="button"
                        onClick={() => {
                            if (!isRenaming) {
                                onLoad(actualIndex);
                            }
                        }}
                        onKeyDown={e => {
                            if (!isRenaming && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault();
                                onLoad(actualIndex);
                            }
                        }}
                        className={classes(cl("row"), isSelected ? "selected" : "")}
                    >
                        <div className={cl("avatar-url")}>
                            {preset.avatarDataUrl && (
                                <img
                                    src={preset.avatarDataUrl}
                                    alt=""
                                    className={cl("avatar")}
                                    style={{ width: `${avatarSize}px`, height: `${avatarSize}px` }}
                                />
                            )}
                            <div className={cl("rename")}>
                                {isRenaming ? (
                                    <TextInput
                                        value={renameText}
                                        onChange={setRenameText}
                                        onBlur={() => {
                                            commitRename();
                                            setRenaming(-1);
                                        }}
                                        onKeyDown={e => {
                                            if (e.key === "Enter") {
                                                commitRename();
                                                setRenaming(-1);
                                            } else if (e.key === "Escape") {
                                                setRenaming(-1);
                                            }
                                            e.stopPropagation();
                                        }}
                                        onClick={e => e.stopPropagation()}
                                        autoFocus
                                    />
                                ) : (
                                    <>
                                        <div className={cl("name")}>
                                            {preset.name}
                                        </div>
                                        <div className={cl("timestamp")}>
                                            {busy === actualIndex ? "Updating..." : `${formattedDate} at ${formattedTime}`}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className={cl("updated")}>
                            <button
                                type="button"
                                aria-label="Options"
                                aria-expanded={openMenu === actualIndex}
                                className={cl("menu-button")}
                                onClick={e => {
                                    e.stopPropagation();
                                    setOpenMenu(openMenu === actualIndex ? -1 : actualIndex);
                                }}
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20">
                                    <path fill="currentColor" d={DOTS} />
                                </svg>
                            </button>

                            {openMenu === actualIndex && (
                                <div className={cl("menu")} onClick={e => e.stopPropagation()}>
                                    <button
                                        type="button"
                                        className={cl("menu-item")}
                                        onClick={act(() => {
                                            setRenaming(actualIndex);
                                            setRenameText(preset.name);
                                        })}
                                    >
                                        Rename
                                    </button>
                                    <button
                                        type="button"
                                        className={cl("menu-item")}
                                        onClick={act(() => openModal(modalProps => (
                                            <DetailsModal
                                                {...modalProps}
                                                preset={preset}
                                                index={actualIndex}
                                                section={section}
                                                guildId={guildId}
                                                onUpdate={onUpdate}
                                            />
                                        )))}
                                    >
                                        What is in it
                                    </button>
                                    <button
                                        type="button"
                                        className={cl("menu-item")}
                                        onClick={act(async () => {
                                            setBusy(actualIndex);
                                            try {
                                                const profile = await getCurrentProfile(guildId, { isGuildProfile });
                                                await updatePresetFields(actualIndex, profile, section);
                                                onUpdate();
                                            } finally {
                                                setBusy(-1);
                                            }
                                        })}
                                    >
                                        Update from profile
                                    </button>
                                    {actualIndex > 0 && (
                                        <button
                                            type="button"
                                            className={cl("menu-item")}
                                            onClick={act(() => {
                                                movePreset(actualIndex, actualIndex - 1, section, guildId);
                                                onUpdate();
                                            })}
                                        >
                                            Move up
                                        </button>
                                    )}
                                    {actualIndex < allPresets.length - 1 && (
                                        <button
                                            type="button"
                                            className={cl("menu-item")}
                                            onClick={act(() => {
                                                movePreset(actualIndex, actualIndex + 1, section, guildId);
                                                onUpdate();
                                            })}
                                        >
                                            Move down
                                        </button>
                                    )}
                                    {currentPage > 1 && (
                                        <button
                                            type="button"
                                            className={cl("menu-item")}
                                            onClick={act(() => {
                                                movePreset(actualIndex, 0, section, guildId);
                                                onPageChange(1);
                                                onUpdate();
                                            })}
                                        >
                                            Move to page 1
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className={cl("menu-item")}
                                        onClick={act(async () => {
                                            const landed = await sendPreset(actualIndex, section, "copy");
                                            if (landed) showToast(`Copied to ${other} as ${landed}`, Toasts.Type.SUCCESS);
                                            onUpdate();
                                        })}
                                    >
                                        Copy to {other}
                                    </button>
                                    <button
                                        type="button"
                                        className={cl("menu-item")}
                                        onClick={act(async () => {
                                            const landed = await sendPreset(actualIndex, section, "move");
                                            if (landed) showToast(`Moved to ${other} as ${landed}`, Toasts.Type.SUCCESS);
                                            onUpdate();
                                        })}
                                    >
                                        Move to {other}
                                    </button>
                                    <button
                                        type="button"
                                        className={classes(cl("menu-item"), cl("menu-item-danger"))}
                                        onClick={act(async () => {
                                            await deletePreset(actualIndex, section, guildId);
                                            onUpdate();
                                        })}
                                    >
                                        Delete
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
