/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, React, showToast, Text, Toasts, UserStore } from "@webpack/common";

import { cl } from "../index";
import { updatePresetFields } from "../utils/actions";
import { describe, palette, size, weight } from "../utils/inspect";
import { loadPresetAsPending } from "../utils/profile";
import { PresetSection, type ProfilePresetEx } from "../utils/storage";

interface Props extends RenderModalProps {
    preset: ProfilePresetEx;
    index: number;
    section: PresetSection;
    guildId?: string;
    onUpdate: () => void;
}

const hex = (colour: number) => `#${colour.toString(16).padStart(6, "0")}`;

export function DetailsModal({ preset, index, section, guildId, onUpdate, ...props }: Props) {
    const fields = describe(preset);
    const carried = fields.filter(field => field.value != null);

    const [picked, setPicked] = React.useState<string[]>(() => carried.map(field => field.key));
    const [colours, setColours] = React.useState<number[]>();
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => {
        let alive = true;
        if (preset.avatarDataUrl) palette(preset.avatarDataUrl).then(found => { if (alive) setColours(found); });
        return () => { alive = false; };
    }, [preset.avatarDataUrl]);

    const toggle = (key: string) => setPicked(prev =>
        prev.includes(key) ? prev.filter(one => one !== key) : [...prev, key]);

    async function loadParts() {
        setBusy(true);
        try {
            await loadPresetAsPending(preset, guildId, { isGuildProfile: section === "server", only: picked });
            const userId = UserStore.getCurrentUser()?.id;
            if (userId != null) openUserProfile(userId, guildId ?? null);
            props.onClose();
        } catch (err) {
            showToast(`Could not load that: ${err}`, Toasts.Type.FAILURE);
        } finally {
            setBusy(false);
        }
    }

    async function useColours(next: number[]) {
        await updatePresetFields(index, { accentColor: next[0], themeColors: next.slice(0, 2) }, section);
        onUpdate();
        showToast("Colours taken from the avatar", Toasts.Type.SUCCESS);
    }

    const total = weight(preset);

    return (
        <Modal {...props} size="md" title={preset.name}>
            <div className={cl("details")}>
                <Text variant="text-sm/normal">
                    {carried.length} of {fields.length} parts saved, {size(total)} on disk.
                    {total > 2_000_000 && " Most of that is the pictures, kept as text."}
                </Text>

                <div className={cl("details-list")}>
                    {fields.map(field => (
                        <label key={field.key} className={classes(cl("details-row"), field.value == null ? cl("details-row-empty") : "")}>
                            <input
                                type="checkbox"
                                checked={picked.includes(field.key)}
                                disabled={field.value == null}
                                onChange={() => toggle(field.key)}
                            />
                            <span className={cl("details-label")}>{field.label}</span>
                            <span className={cl("details-value")}>
                                {field.value ?? "nothing saved"}
                                {field.bytes > 0 && `, ${size(field.bytes)}`}
                            </span>
                        </label>
                    ))}
                </div>

                {colours && colours.length > 0 && (
                    <>
                        <Heading tag="h3" className={cl("heading")}>Colours in the avatar</Heading>
                        <div className={cl("swatches")}>
                            {colours.map(colour => (
                                <span
                                    key={colour}
                                    className={cl("swatch")}
                                    style={{ background: hex(colour) }}
                                    title={hex(colour)}
                                />
                            ))}
                        </div>
                        <Button size="small" variant="secondary" onClick={() => useColours(colours)}>
                            Use the first two
                        </Button>
                    </>
                )}

                <div className={cl("details-apply")}>
                    <Text variant="text-sm/normal">
                        {picked.length === carried.length ? "everything it has" : `${picked.length} of ${carried.length} parts`}
                    </Text>
                    <Button size="small" disabled={busy || !picked.length} onClick={loadParts}>
                        Load these
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
