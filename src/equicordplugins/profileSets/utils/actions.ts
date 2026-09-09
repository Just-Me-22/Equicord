/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isNonNullish } from "@utils/guards";
import { ProfilePreset } from "@vencord/discord-types";
import { showToast, Toasts, UserProfileSettingsStore } from "@webpack/common";

import { getCurrentProfile, otherProfile } from "./profile";
import { addPreset, appendToSection, movePresetInArray, presets, PresetSection, type ProfilePresetEx, removePreset, replaceAllPresets, savePresetsData, updatePreset } from "./storage";

function isImageInput(value: unknown): value is string | { imageUri: string; } {
    if (typeof value === "string") return value.length > 0;
    return typeof value === "object" && isNonNullish(value) && "imageUri" in value && typeof (value as { imageUri: unknown; }).imageUri === "string";
}

function getFreshPendingAvatar(section: PresetSection, guildId?: string): string | null {
    if (section === "server" && !guildId) return null;
    const pending = (section === "server"
        ? UserProfileSettingsStore.getPendingChanges?.(guildId)
        : UserProfileSettingsStore.getPendingChanges?.()) ?? {};
    const pendingObj = pending as Record<string, unknown>;
    const selected = [pendingObj.pendingAvatar].find(isImageInput);
    if (!selected) return null;
    return typeof selected === "string" ? selected : selected.imageUri;
}

export async function savePreset(name: string, section: PresetSection, guildId?: string) {
    const profile = await getCurrentProfile(guildId, { isGuildProfile: section === "server" });
    const freshPendingAvatar = getFreshPendingAvatar(section, guildId);
    const effectiveAvatar = freshPendingAvatar ?? profile.avatarDataUrl ?? null;

    const newPreset: ProfilePresetEx = {
        name,
        timestamp: Date.now(),
        ...profile,
        avatarDataUrl: effectiveAvatar,
    };
    addPreset(newPreset);
    await savePresetsData(section);
}

export async function updatePresetFields(
    index: number,
    fields: Partial<Omit<ProfilePreset, "name" | "timestamp">>,
    section: PresetSection
) {
    if (index < 0 || index >= presets.length) return;

    const changed = Object.fromEntries(Object.entries(fields).filter(([, value]) => isNonNullish(value)));
    updatePreset(index, { ...presets[index], ...changed, timestamp: Date.now() });
    await savePresetsData(section);
}

/** a server profile has no slot for a custom status or a server tag, and loading one
 *  already skips them, so they travel with the preset rather than being thrown away.
 *  sending it back the other way then still has them. */
export async function sendPreset(index: number, from: PresetSection, mode: "copy" | "move") {
    if (index < 0 || index >= presets.length) return null;

    const to: PresetSection = from === "main" ? "server" : "main";
    const landed = await appendToSection(to, presets[index]);

    if (mode === "move") {
        removePreset(index);
        await savePresetsData(from);
    }

    return landed;
}

/** only what their profile hands out publicly. their custom status and server tag are
 *  theirs and are left behind, along with anything a nitro subscription pays for that
 *  you do not have: discord refuses those on save rather than here. */
export async function stealLook(userId: string, name: string) {
    const taken = await otherProfile(userId);
    if (!taken) return false;

    addPreset({ ...taken, name, timestamp: Date.now() });
    await savePresetsData("main");
    return true;
}

export async function deletePreset(index: number, section: PresetSection) {
    if (index < 0 || index >= presets.length) return;

    removePreset(index);
    await savePresetsData(section);
}

export async function movePreset(fromIndex: number, toIndex: number, section: PresetSection) {
    if (fromIndex < 0 || fromIndex >= presets.length || toIndex < 0 || toIndex >= presets.length) return;

    movePresetInArray(fromIndex, toIndex);
    await savePresetsData(section);
}

export async function renamePreset(index: number, newName: string, section: PresetSection) {
    if (index < 0 || index >= presets.length || !newName.trim()) return;

    const updatedPreset = { ...presets[index], name: newName.trim() };
    updatePreset(index, updatedPreset);
    await savePresetsData(section);
}

export function exportPresets(section: PresetSection) {
    const dataStr = JSON.stringify(presets, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `profile-presets-${section}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

export type ImportDecision = "override" | "merge" | "cancel";

export async function importPresets(
    forceUpdate: () => void,
    onImportPrompt: (existingCount: number) => Promise<ImportDecision>,
    section: PresetSection
) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (event: Event) => {
        try {
            const target = event.currentTarget as HTMLInputElement | null;
            const file = target?.files?.[0];
            if (!file) return;

            const text = await file.text();
            const importedPresets = JSON.parse(text);

            if (!Array.isArray(importedPresets)) {
                return;
            }

            if (presets.length > 0) {
                const decision = await onImportPrompt(presets.length);
                if (decision === "cancel") return;
                if (decision === "override") {
                    replaceAllPresets(importedPresets);
                } else {
                    const combined = [...presets, ...importedPresets];
                    replaceAllPresets(combined);
                }
            } else {
                replaceAllPresets(importedPresets);
            }

            await savePresetsData(section);
            forceUpdate();
        } catch {
            showToast("Failed to import presets. The file might be invalid.", Toasts.Type.FAILURE);
        }
    };
    input.click();
}
