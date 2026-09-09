/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { openModal, React, SelectedGuildStore, showToast, TextInput, Toasts, UserStore, useStateFromStores } from "@webpack/common";

import { cl, settings } from "../index";
import { exportPresets, ImportDecision, importPresets, savePreset } from "../utils/actions";
import { size, weight } from "../utils/inspect";
import { hasUndo, loadPresetAsPending, undoLast } from "../utils/profile";
import { loadPresets, presets, PresetSection, setCurrentPresetIndex } from "../utils/storage";
import { ImportProfilesModal } from "./confirmModal";
import { PresetList } from "./presetList";

/** the shelf scrolls instead of paging. five per page meant clicking through pages to
 *  find anything, and paging fought the move up and down actions. */

type PresetManagerProps = {
    section?: PresetSection;
    guildId?: string;
};

export function PresetManager({ section, guildId }: PresetManagerProps) {
    const [presetName, setPresetName] = React.useState("");
    const [search, setSearch] = React.useState("");
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [isSaving, setIsSaving] = React.useState(false);
    const [broken, setBroken] = React.useState(false);
    const [selectedPreset, setSelectedPreset] = React.useState<number>(-1);
    const lastRandomIndexRef = React.useRef<number>(-1);
    const resolvedSection: PresetSection = section ?? "main";
    const isServerSection = resolvedSection === "server";
    const lastSelectedGuildId = useStateFromStores(
        [SelectedGuildStore],
        () => SelectedGuildStore.getLastSelectedGuildId() ?? SelectedGuildStore.getGuildId()
    );
    const resolvedGuildId = isServerSection ? (guildId ?? lastSelectedGuildId ?? undefined) : undefined;
    const canUseGuild = !isServerSection || Boolean(resolvedGuildId);

    // the stored list is per section, not per guild, so changing the server picker used
    // to re-read the same rows and throw away the selection for nothing
    React.useEffect(() => {
        let isActive = true;
        (async () => {
            const ok = await loadPresets(resolvedSection);
            if (!isActive) return;
            setBroken(!ok);
            setSelectedPreset(-1);
            forceUpdate();
        })();
        return () => {
            isActive = false;
        };
    }, [resolvedSection]);

    const wanted = search.trim().toLowerCase();
    const shown = wanted
        ? presets.filter(preset => preset.name.toLowerCase().includes(wanted))
        : presets;

    const handleSavePreset = async () => {
        if (!canUseGuild) return;
        const trimmedName = presetName.trim();
        if (!trimmedName) return;
        setIsSaving(true);
        try {
            await savePreset(trimmedName, resolvedSection, resolvedGuildId);
            setPresetName("");
        } catch (err) {
            showToast(`Could not save that profile: ${err}`, Toasts.Type.FAILURE);
        } finally {
            setIsSaving(false);
            forceUpdate();
        }
    };

    const [canUndo, setCanUndo] = React.useState(false);

    const applyPreset = (index: number) => {
        setSelectedPreset(index);
        setCurrentPresetIndex(index);
        loadPresetAsPending(presets[index], resolvedGuildId, {
            isGuildProfile: resolvedSection === "server"
        }).then(() => {
            const userId = UserStore.getCurrentUser()?.id;
            if (userId != null) openUserProfile(userId, resolvedGuildId ?? null);
        }).then(() => setCanUndo(hasUndo(resolvedGuildId)))
            .catch(err => showToast(`Could not load that profile: ${err}`, Toasts.Type.FAILURE));
        forceUpdate();
    };

    const handleLoadPreset = (index: number) => {
        if (!canUseGuild) return;
        applyPreset(index);
    };

    const selectRandomPreset = (sectionType: PresetSection) => {
        const availablePresets = presets;
        if (!availablePresets.length) return null;
        const randomIndex = Math.floor(Math.random() * availablePresets.length);
        return { preset: availablePresets[randomIndex], index: randomIndex, section: sectionType };
    };

    const handleRandomPreset = () => {
        if (!canUseGuild) return;
        const selection = selectRandomPreset(resolvedSection);
        if (!selection) return;
        let nextIndex = selection.index;
        if (presets.length > 1 && nextIndex === lastRandomIndexRef.current) {
            let attempts = 0;
            while (attempts < 5 && nextIndex === lastRandomIndexRef.current) {
                nextIndex = Math.floor(Math.random() * presets.length);
                attempts++;
            }
        }
        lastRandomIndexRef.current = nextIndex;
        applyPreset(nextIndex);
    };

    const showImportPrompt = (existingCount: number): Promise<ImportDecision> => {
        return new Promise(resolve => {
            openModal(props => (
                <ImportProfilesModal
                    {...props}
                    title="Import Profiles"
                    message={`You have ${existingCount} existing profiles in this section. Do you want to override them or merge with imported profiles?`}
                    onOverride={() => resolve("override")}
                    onMerge={() => resolve("merge")}
                    onCancel={() => resolve("cancel")}
                />
            ));
        });
    };

    const { avatarSize } = settings.store;
    const hasPresets = presets.length > 0;
    const kept = presets.reduce((sum, preset) => sum + weight(preset), 0);

    return (
        <div className={classes(cl("section"), isServerSection ? cl("section-server") : "")} >
            <Heading tag="h3" className={cl("heading")}>
                Saved Profiles
            </Heading>

            <div className={cl("text")}>
                <TextInput
                    placeholder="Name this profile"
                    value={presetName}
                    onChange={setPresetName}
                    className={cl("text-input")}
                />
            </div>

            <div className={cl("search")}>
                <Button
                    size="small"
                    disabled={isSaving || !presetName.trim() || !canUseGuild}
                    onClick={handleSavePreset}
                    className={cl("search-button")}
                >
                    {isSaving ? "Saving..." : "Save Profile"}
                </Button>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={handleRandomPreset}
                    disabled={!presets.length || !canUseGuild}
                >
                    Random
                </Button>
                {canUndo && (
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={async () => {
                            await undoLast(resolvedGuildId);
                            setCanUndo(false);
                            const userId = UserStore.getCurrentUser()?.id;
                            if (userId != null) openUserProfile(userId, resolvedGuildId ?? null);
                        }}
                    >
                        Undo load
                    </Button>
                )}
                <Button
                    size="small"
                    variant="secondary"
                    onClick={() => importPresets(forceUpdate, showImportPrompt, resolvedSection)}
                    disabled={!canUseGuild}
                >
                    Import
                </Button>
                {hasPresets && (
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={() => exportPresets(resolvedSection)}
                    >
                        Export All
                    </Button>
                )}
            </div>

            {broken && (
                <p className={cl("empty-state")}>
                    Your saved profiles could not be read. Nothing has been lost, but do not save over
                    them until this loads properly.
                </p>
            )}

            {hasPresets && (
                <>
                    <div className={cl("bar")}>
                        <span className={cl("count")}>
                            {wanted ? `${shown.length} of ${presets.length}` : `${presets.length} kept, ${size(kept)}`}
                        </span>
                        {presets.length > 4 && (
                            <div className={cl("find")}>
                                <input
                                    type="text"
                                    value={search}
                                    placeholder="Search"
                                    aria-label="Search saved profiles"
                                    onChange={event => setSearch(event.currentTarget.value)}
                                />
                                {search && (
                                    <button type="button" aria-label="Clear the search" onClick={() => setSearch("")}>
                                        &times;
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <PresetList
                        presets={shown}
                        allPresets={presets}
                        avatarSize={avatarSize}
                        selectedPreset={selectedPreset}
                        onLoad={handleLoadPreset}
                        onUpdate={forceUpdate}
                        guildId={resolvedGuildId}
                        section={resolvedSection}
                    />

                    <hr className={cl("block")} />
                </>
            )}

            <hr className={cl("block")} />
            {resolvedSection === "server" && (
                <hr className={cl("block")} />
            )}
        </div>
    );
}
