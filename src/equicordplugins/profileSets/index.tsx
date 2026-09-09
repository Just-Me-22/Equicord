/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, showToast, Toasts, UserStore } from "@webpack/common";

import ProfileSetsTab from "./components/profileSetsTab";
import { stealLook } from "./utils/actions";
import { loadPresets } from "./utils/storage";

export const cl = classNameFactory("vc-profile-presets-");
export const settings = definePluginSettings({
    avatarSize: {
        type: OptionType.SLIDER,
        description: "Avatar size in preset list.",
        markers: [56, 64, 72, 80, 88, 96],
        default: 56,
        stickToMarkers: true
    },
});

/** their public parts, saved as a starting point. it lands in your main profile sets
 *  rather than being worn, so nothing changes until you load it. */
const UserPatch: NavContextMenuPatchCallback = (children, { user }: { user?: { id: string; username: string; globalName?: string | null; }; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;

    const group = findGroupChildrenByChildId("roles", children) ?? findGroupChildrenByChildId("user-profile", children);

    group?.push(
        <Menu.MenuItem
            id="vc-profile-sets-steal"
            label="Save Their Look"
            action={async () => {
                await loadPresets("main");
                const name = user.globalName || user.username;
                const done = await stealLook(user.id, name);
                showToast(
                    done ? `Saved ${name} to your main profile sets` : "Could not read that profile",
                    done ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE
                );
            }}
        />
    );
};

export default definePlugin({
    name: "ProfileSets",
    description: "Allows you to save and load different profile presets.",
    tags: ["Appearance", "Customisation", "Utility"],
    authors: [EquicordDevs.omaw, EquicordDevs.justjxke],
    settings,

    contextMenus: {
        "user-context": UserPatch
    },
    patches: [
        // the tabs component destructures its props, so the list can be extended on the
        // way in. the array is built elsewhere and GitHubRepos already patches that site,
        // which is why reaching for it positionally there does not work.
        {
            find: "UserProfileModalV2Tabs",
            replacement: {
                match: /(\{user:\i,currentUser:\i,displayProfile:\i,guildId:\i,channelId:\i,items:\i,initialSection:\i,onClose:\i\}=)(\i)(?=,\{trackUserProfileAction)/,
                replace: "$1$self.withSetsTab($2)"
            }
        },
        // what the tab renders once it is selected
        {
            find: ".WIDGETS?",
            replacement: {
                match: /(\i)===\i\.\i\.WISHLIST/,
                replace: '$1==="PROFILE_SETS"?$self.renderProfileSetsTab(arguments[0]):$&'
            }
        }
    ],

    /** presets are your own, so the tab has no business on anyone else's profile. every
     *  branch returns the props untouched, so an unexpected shape costs the tab and
     *  nothing else. */
    withSetsTab(props: any) {
        try {
            if (props?.user?.id !== UserStore.getCurrentUser()?.id) return props;
            if (!Array.isArray(props.items)) return props;
            if (props.items.some((i: any) => i?.section === "PROFILE_SETS")) return props;
            return { ...props, items: [...props.items, { text: "Sets", section: "PROFILE_SETS" }] };
        } catch {
            return props;
        }
    },

    renderProfileSetsTab: ErrorBoundary.wrap((props: any) => <ProfileSetsTab {...props} />, { noop: true }),

    start() {
        loadPresets("main");
    },
});
