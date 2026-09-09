/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getUserSettingLazy } from "@api/UserSettings";
import { fetchUserProfile } from "@utils/discord";
import { AvatarDecorationData, CustomStatus, DisplayNameStyles, Nameplate, ProfileEffect } from "@vencord/discord-types";
import { FluxDispatcher, GuildMemberStore, IconUtils, UserProfileSettingsStore, UserProfileStore, UserStore } from "@webpack/common";

import { ProfileFrame, ProfilePresetEx } from "./storage";

const CustomStatusSettings = getUserSettingLazy("status", "customStatus")!;

type PendingChanges = Record<string, unknown> & {
    pendingAvatar?: ImageInput;
    pendingBanner?: ImageInput;
    pendingAvatarDecoration?: AvatarDecorationLike | null;
    pendingProfileEffect?: ProfileEffect | null;
    pendingNameplate?: Nameplate | null;
    pendingProfileFrame?: ProfileFrame | null;
    pendingDisplayNameStyles?: DisplayNameStyles | null;
    pendingAccentColor?: number | null;
    pendingThemeColors?: number[] | null;
    pendingBio?: string | null;
    pendingPronouns?: string | null;
    pendingNickname?: string | null;
    pendingGlobalName?: string | null;
    pendingPrimaryGuildId?: string | null;
};

type ImageInput = string | { imageUri: string;[key: string]: unknown; } | null | undefined;
type AvatarDecorationLike = AvatarDecorationData & {
    label?: string;
    type?: number;
};
type DisplayNameStylesLike = DisplayNameStyles & {
    fontId?: number;
    effectId?: number;
};

type CurrentProfileOptions = {
    isGuildProfile?: boolean;
};

type LoadPresetOptions = {
    skipGlobalName?: boolean;
    skipBio?: boolean;
    skipPronouns?: boolean;
    isGuildProfile?: boolean;
    /** field names to apply. leave it out and everything the preset has goes on. */
    only?: string[];
};

/** what was on before the last load, so one button puts it back. one per profile,
 *  since a server profile and the main one are staged separately. */
const before = new Map<string, ProfilePresetEx>();

/** the snapshot is loaded through the same path it was taken from, so it has to be
 *  recognisable or undoing would overwrite the snapshot with itself */
const UNDO_NAME = "profilesets-undo-snapshot";

const slot = (guildId?: string) => guildId ?? "main";

export const hasUndo = (guildId?: string) => before.has(slot(guildId));

export async function undoLast(guildId?: string) {
    const kept = before.get(slot(guildId));
    if (!kept) return false;

    before.delete(slot(guildId));
    await loadPresetAsPending(kept, guildId, { isGuildProfile: guildId != null });
    return true;
}

function dispatch(type: string, payload: Record<string, unknown>) {
    FluxDispatcher.dispatch({ type, ...payload });
}

function setPendingChanges(payload: Record<string, unknown>, guildId?: string) {
    dispatch("USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", guildId ? { guildId, ...payload } : payload);
}

/** discord stores a freshly picked image as an upload descriptor, not a bare url. anything
 *  already on its cdn, and null to clear, goes through untouched. */
function toPendingImage(value: unknown, presetName?: string) {
    if (typeof value !== "string" || !value.startsWith("data:")) return value;
    return {
        assetOrigin: "NEW_ASSET",
        imageUri: value,
        description: `profilesets-${presetName ?? "preset"}`
    };
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function hasImageInput(value: ImageInput): boolean {
    if (!value) return false;
    if (typeof value === "string") return value.length > 0;
    return typeof value === "object" && isNonEmptyString(value?.imageUri);
}

function hasAvatarDecoration(value: unknown): value is AvatarDecorationLike {
    return typeof value === "object"
        && value != null
        && "asset" in value
        && "skuId" in value
        && isNonEmptyString((value as { asset?: unknown; }).asset)
        && isNonEmptyString((value as { skuId?: unknown; }).skuId);
}

function normalizeDisplayNameStyles(value: DisplayNameStylesLike | null | undefined): DisplayNameStylesLike | null {
    if (!value) return null;
    const fontId = value.fontId ?? value.font_id;
    const effectId = value.effectId ?? value.effect_id;
    if (typeof fontId !== "number" || typeof effectId !== "number") return null;
    const colors = Array.isArray(value.colors) ? [...value.colors] : [];

    return {
        fontId,
        effectId,
        font_id: fontId,
        effect_id: effectId,
        colors
    };
}

export async function imageUrlToBase64(url: string): Promise<string | null> {
    try {
        // a stalled cdn request used to hang the save with no way out, since the button
        // only clears once this resolves.
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

async function processImage(imageData: ImageInput, userId: string, type: "avatar" | "banner", guildId?: string, useGuildPath?: boolean): Promise<string | null> {
    if (!imageData) return null;

    if (typeof imageData === "object" && isNonEmptyString(imageData?.imageUri)) {
        return imageData.imageUri;
    }

    if (typeof imageData === "string") {
        if (imageData.startsWith("data:")) return imageData;
        if (/^https?:\/\//.test(imageData)) {
            return await imageUrlToBase64(imageData);
        }

        const isAnimated = imageData.startsWith("a_");
        const size = type === "banner" ? 1024 : 512;
        const urlPath = type === "banner" ? "banners" : "avatars";
        const guildPath = guildId ? `guilds/${guildId}/users/${userId}/${type === "banner" ? "banners" : "avatars"}` : urlPath;
        const guildUrl = `https://cdn.discordapp.com/${guildPath}/${imageData}.${isAnimated ? "gif" : "png"}?size=${size}`;
        const globalUrl = `https://cdn.discordapp.com/${urlPath}/${userId}/${imageData}.${isAnimated ? "gif" : "png"}?size=${size}`;
        if (useGuildPath && guildId) {
            const guildResult = await imageUrlToBase64(guildUrl);
            if (guildResult) return guildResult;
        }
        return await imageUrlToBase64(globalUrl);
    }

    return null;
}

/** someone else's profile, read the way a preset is shaped. the images come down as
 *  data urls the same as your own, so the set does not break when they change theirs. */
export async function otherProfile(userId: string): Promise<Omit<ProfilePresetEx, "name" | "timestamp"> | null> {
    const user = UserStore.getUser(userId);
    const profile = await fetchUserProfile(userId);
    if (!user) return null;

    const avatar = IconUtils.getUserAvatarURL(user, true, 512);
    const banner = profile?.banner
        ? `https://cdn.discordapp.com/banners/${userId}/${profile.banner}.${profile.banner.startsWith("a_") ? "gif" : "png"}?size=1024`
        : null;

    const decoration = (user as any).avatarDecorationData;
    const plate = (user as any).collectibles?.nameplate;

    return {
        avatarDataUrl: avatar ? await imageUrlToBase64(avatar) : null,
        bannerDataUrl: banner ? await imageUrlToBase64(banner) : null,
        bio: profile?.bio ?? null,
        accentColor: profile?.accentColor ?? null,
        themeColors: profile?.themeColors ?? null,
        globalName: user.globalName ?? null,
        pronouns: profile?.pronouns ?? null,
        avatarDecoration: hasAvatarDecoration(decoration) ? { ...decoration, asset: decoration.asset, skuId: decoration.skuId } : null,
        profileEffect: profile?.profileEffect ?? null,
        profileFrame: (profile as any)?.profileFrame ?? null,
        nameplate: plate ? { skuId: plate.skuId, asset: plate.asset, label: plate.label, palette: typeof plate.palette === "string" ? plate.palette : undefined, type: plate.type || 2 } : null,
        primaryGuildId: null,
        customStatus: null,
        displayNameStyles: normalizeDisplayNameStyles((user as any).displayNameStyles)
    };
}

export async function getCurrentProfile(guildId?: string, options: CurrentProfileOptions = {}): Promise<Omit<ProfilePresetEx, "name" | "timestamp">> {
    const currentUser = UserStore.getCurrentUser();
    const baseProfile = await fetchUserProfile(currentUser.id);
    const isGuildProfile = options.isGuildProfile ?? Boolean(guildId);
    const effectiveGuildId = isGuildProfile ? guildId : undefined;
    const guildProfile = effectiveGuildId ? UserProfileStore.getGuildMemberProfile(currentUser.id, effectiveGuildId) : null;
    const userProfile = guildProfile ?? baseProfile;
    const userAny = currentUser;
    const guildMember = effectiveGuildId ? GuildMemberStore.getMember(effectiveGuildId, currentUser.id) : null;

    // a guild profile reads only its own staged changes. falling back to the main profile's
    // when the guild had none put a main profile avatar into a server preset.
    const pendingChanges: PendingChanges = (isGuildProfile
        ? (effectiveGuildId ? UserProfileSettingsStore.getPendingChanges(effectiveGuildId) : null)
        : UserProfileSettingsStore.getPendingChanges()) ?? {};
    const customStatusSetting = CustomStatusSettings.getSetting();
    const customStatus = isGuildProfile
        ? null
        : {
            text: customStatusSetting?.text ?? "",
            emojiId: customStatusSetting?.emojiId ?? "0",
            emojiName: customStatusSetting?.emojiName ?? "",
            expiresAtMs: customStatusSetting?.expiresAtMs ?? "0"
        };

    const avatarDecorationSource = pendingChanges.pendingAvatarDecoration
        ?? (isGuildProfile ? guildMember?.avatarDecoration : userAny.avatarDecorationData);
    const avatarDecoration = hasAvatarDecoration(avatarDecorationSource)
        ? {
            ...avatarDecorationSource,
            asset: avatarDecorationSource.asset,
            skuId: avatarDecorationSource.skuId
        }
        : null;

    let profileEffect: ProfileEffect | null = null;
    const effectToUse = pendingChanges.pendingProfileEffect ?? userProfile?.profileEffect;

    if (effectToUse) {
        if (effectToUse.skuId && effectToUse.effects) {
            profileEffect = {
                skuId: effectToUse.skuId,
                title: effectToUse.title,
                description: effectToUse.description,
                accessibilityLabel: effectToUse.accessibilityLabel,
                reducedMotionSrc: effectToUse.reducedMotionSrc,
                thumbnailPreviewSrc: effectToUse.thumbnailPreviewSrc,
                effects: effectToUse.effects,
                animationType: effectToUse.animationType,
                staticFrameSrc: effectToUse.staticFrameSrc,
                type: effectToUse.type || 1
            };
        } else if (effectToUse.skuId) {
            const collectibles = userProfile?.collectibles;
            const collectible = collectibles?.find(c => c?.skuId === effectToUse.skuId);
            if (collectible) {
                profileEffect = {
                    skuId: collectible.skuId,
                    title: collectible.title,
                    description: collectible.description,
                    accessibilityLabel: collectible.accessibilityLabel,
                    reducedMotionSrc: collectible.reducedMotionSrc,
                    thumbnailPreviewSrc: collectible.thumbnailPreviewSrc,
                    effects: collectible.effects,
                    animationType: collectible.animationType,
                    staticFrameSrc: collectible.staticFrameSrc,
                    type: collectible.type || 1
                };
            }
        }
    }

    const profileFrame = (pendingChanges.pendingProfileFrame ?? (userProfile as any)?.profileFrame ?? null) as ProfileFrame | null;

    const nameplateToUse = pendingChanges.pendingNameplate
        ?? (isGuildProfile ? guildMember?.collectibles?.nameplate : userAny.collectibles?.nameplate);
    const nameplate = nameplateToUse ? {
        skuId: nameplateToUse.skuId,
        asset: nameplateToUse.asset,
        label: nameplateToUse.label,
        palette: typeof nameplateToUse.palette === "string" ? nameplateToUse.palette : undefined,
        type: nameplateToUse.type || 2
    } : null;

    const savedDisplayNameStyles = isGuildProfile
        ? (guildMember?.displayNameStyles ?? userAny.displayNameStyles)
        : userAny.displayNameStyles;
    const displayNameStylesToUse = pendingChanges.pendingDisplayNameStyles ?? savedDisplayNameStyles;
    const displayNameStyles = normalizeDisplayNameStyles(displayNameStylesToUse);

    const { pendingAvatar } = pendingChanges;
    const avatarToUse: ImageInput = hasImageInput(pendingAvatar)
        ? pendingAvatar
        : (isGuildProfile ? (guildMember?.avatar ?? currentUser.avatar ?? null) : (currentUser.avatar ?? null));

    const useGuildAvatar = !!(effectiveGuildId && isGuildProfile && guildMember?.avatar && avatarToUse === guildMember.avatar);

    const avatarInput: ImageInput = hasImageInput(avatarToUse)
        ? avatarToUse
        : IconUtils.getUserAvatarURL(currentUser, true, 512);
    const avatarDataUrl = await processImage(avatarInput, currentUser.id, "avatar", effectiveGuildId, useGuildAvatar);
    const resolvedAvatarDataUrl = avatarDataUrl ?? IconUtils.getDefaultAvatarURL(currentUser.id);

    const { pendingBanner } = pendingChanges;
    const bannerToUse: ImageInput = hasImageInput(pendingBanner)
        ? pendingBanner
        : (isGuildProfile ? (guildProfile?.banner ?? baseProfile?.banner) : baseProfile?.banner);
    const useGuildBanner = !!(effectiveGuildId && isGuildProfile && guildProfile?.banner && bannerToUse === guildProfile?.banner);

    const bannerDataUrl = await processImage(bannerToUse, currentUser.id, "banner", effectiveGuildId, useGuildBanner);

    return {
        avatarDataUrl: resolvedAvatarDataUrl,
        bannerDataUrl,
        bio: pendingChanges.pendingBio ?? userProfile?.bio ?? null,
        accentColor: pendingChanges.pendingAccentColor ?? userProfile?.accentColor ?? null,
        themeColors: pendingChanges.pendingThemeColors ?? userProfile?.themeColors ?? null,
        globalName: isGuildProfile
            ? (pendingChanges.pendingNickname ?? guildMember?.nick ?? null)
            : (pendingChanges.pendingGlobalName ?? currentUser.globalName ?? null),
        pronouns: pendingChanges.pendingPronouns ?? userProfile?.pronouns ?? null,
        avatarDecoration,
        profileEffect,
        profileFrame,
        nameplate,
        primaryGuildId: isGuildProfile
            ? null
            : (pendingChanges.pendingPrimaryGuildId ?? userAny.primaryGuild?.identityGuildId ?? null),
        customStatus,
        displayNameStyles
    };
}

function jsonEq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}

function customStatusEq(a: CustomStatus | null | undefined, b: CustomStatus | null | undefined): boolean {
    if (a == null || b == null) return a == null && b == null;
    return a.text === b.text
        && String(a.emojiId ?? "") === String(b.emojiId ?? "")
        && a.emojiName === b.emojiName
        && String(a.expiresAtMs ?? "0") === String(b.expiresAtMs ?? "0");
}

function resolvePendingAvatar(pendingChanges: PendingChanges | null): ImageInput {
    if (!pendingChanges) return null;

    return hasImageInput(pendingChanges.pendingAvatar) ? pendingChanges.pendingAvatar : null;
}

function normalizeImageValue(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "imageUri" in value) {
        const { imageUri } = value as { imageUri: unknown; };
        return typeof imageUri === "string" ? imageUri : null;
    }
    return null;
}

function collectibleEqBySku(a: { skuId?: string | number | null; } | null | undefined, b: { skuId?: string | number | null; } | null | undefined): boolean {
    if (a == null || b == null) return a == null && b == null;
    return String(a.skuId ?? "") === String(b.skuId ?? "");
}

function avatarDecorationEq(a: { skuId?: string | number | null; asset?: string | null; } | null | undefined, b: { skuId?: string | number | null; asset?: string | null; } | null | undefined): boolean {
    if (a == null || b == null) return a == null && b == null;
    return String(a.skuId ?? "") === String(b.skuId ?? "") && String(a.asset ?? "") === String(b.asset ?? "");
}

function nameplateEq(a: { skuId?: string | number | null; asset?: string | null; } | null | undefined, b: { skuId?: string | number | null; asset?: string | null; } | null | undefined): boolean {
    if (a == null || b == null) return a == null && b == null;
    return String(a.skuId ?? "") === String(b.skuId ?? "") && String(a.asset ?? "") === String(b.asset ?? "");
}

export async function loadPresetAsPending(preset: ProfilePresetEx, guildId?: string, options: LoadPresetOptions = {}) {
    try {
        const isGuild = options.isGuildProfile ?? Boolean(guildId);
        if (isGuild && !guildId) return;
        const current = await getCurrentProfile(guildId, {
            isGuildProfile: isGuild
        });

        if (preset.name !== UNDO_NAME) {
            before.set(slot(isGuild ? guildId : undefined), { ...current, name: UNDO_NAME, timestamp: Date.now() });
        }

        const wanted = (field: string) => !options.only?.length || options.only.includes(field);
        const pendingChanges = (isGuild && guildId
            ? UserProfileSettingsStore.getPendingChanges(guildId)
            : UserProfileSettingsStore.getPendingChanges());
        const setPending = (payload: Record<string, unknown>) => {
            const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
            if (!Object.keys(cleanPayload).length) return;
            setPendingChanges(cleanPayload, isGuild ? guildId : undefined);
        };

        if (wanted("avatar") && "avatarDataUrl" in preset) {
            const avatarValue = preset.avatarDataUrl;
            const presetAvatar = normalizeImageValue(avatarValue);
            const currentAvatar = normalizeImageValue(current.avatarDataUrl);
            const pendingAvatar = normalizeImageValue(resolvePendingAvatar(pendingChanges));
            if (presetAvatar !== currentAvatar && presetAvatar !== pendingAvatar) {
                setPending({ pendingAvatar: toPendingImage(avatarValue, preset.name) });
            }
        }

        if (wanted("banner") && "bannerDataUrl" in preset && preset.bannerDataUrl !== current.bannerDataUrl) {
            setPending({ pendingBanner: toPendingImage(preset.bannerDataUrl, preset.name) });
        }

        if (wanted("bio") && !options.skipBio && preset?.bio !== current?.bio) {
            setPending({ pendingBio: preset.bio ?? "" });
        }

        if (wanted("pronouns") && !options.skipPronouns && preset?.pronouns !== current?.pronouns) {
            setPending({ pendingPronouns: preset.pronouns ?? "" });
        }

        if (wanted("name") && !options.skipGlobalName && preset?.globalName !== current?.globalName) {
            setPending(isGuild ? { pendingNickname: preset.globalName } : { pendingGlobalName: preset.globalName });
        }

        if (wanted("decoration") && preset.avatarDecoration !== undefined && !avatarDecorationEq(preset.avatarDecoration, current.avatarDecoration)) {
            setPending({
                pendingAvatarDecoration: preset.avatarDecoration
            });
        }

        if (wanted("effect") && preset.profileEffect !== undefined && !collectibleEqBySku(preset.profileEffect, current.profileEffect)) {
            setPending({
                pendingProfileEffect: preset.profileEffect
            });
        }

        if (wanted("frame") && preset.profileFrame !== undefined && !collectibleEqBySku(preset.profileFrame, current.profileFrame)) {
            setPending({
                pendingProfileFrame: preset.profileFrame
            });
        }

        if (wanted("nameplate") && preset.nameplate !== undefined && !nameplateEq(preset.nameplate, current.nameplate)) {
            setPending({
                pendingNameplate: preset.nameplate
            });
        }

        if (wanted("nameStyle") && preset.displayNameStyles) {
            const presetDisplayNameStyles = normalizeDisplayNameStyles(preset.displayNameStyles);
            if (!jsonEq(presetDisplayNameStyles, current.displayNameStyles)) {
                setPending({ pendingDisplayNameStyles: presetDisplayNameStyles });
            }
        }

        if (wanted("colours") && preset.themeColors && !jsonEq(preset.themeColors, current.themeColors)) {
            setPending({ pendingThemeColors: preset.themeColors });
        }

        // saved by every preset but never applied until now, so a set with a colour in
        // it looked like it had lost one
        if (wanted("colours") && preset.accentColor !== undefined && preset.accentColor !== current.accentColor) {
            setPending({ pendingAccentColor: preset.accentColor });
        }

        if (wanted("tag") && preset.primaryGuildId && !isGuild && preset.primaryGuildId !== current.primaryGuildId) {
            setPending({ pendingPrimaryGuildId: preset.primaryGuildId });
        }

        if (wanted("status") && preset.customStatus && !isGuild && !customStatusEq(preset.customStatus, current.customStatus)) {
            CustomStatusSettings.updateSetting({
                text: preset.customStatus?.text ?? "",
                expiresAtMs: preset.customStatus?.expiresAtMs ?? "0",
                emojiId: preset.customStatus?.emojiId ?? "0",
                emojiName: preset.customStatus?.emojiName ?? ""
            });
        }
    } catch (err) {
        throw err;
    }
}
