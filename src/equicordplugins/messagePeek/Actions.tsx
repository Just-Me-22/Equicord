/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Channel, Message } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { Constants, Popout, ReadStateStore, ReadStateUtils, RestAPI, showToast, Toasts, useRef, useState, useStateFromStores } from "@webpack/common";

import { useLastMessage } from "./hooks";
import { settings } from "./settings";

const cl = classNameFactory("vc-message-peek-");
const logger = new Logger("MessagePeek");

const ReactionEmojiPicker = findComponentByCodeLazy<any>("showAddEmojiButton:", "pickerIntention:", "messageId:");

interface EmojiSelectPayload {
    id?: string | null;
    name?: string | null;
    optionallyDiverseSequence?: string;
}

function emojiValue(emoji: EmojiSelectPayload | null) {
    if (!emoji) return "";
    if (emoji.id && emoji.name) return `${emoji.name}:${emoji.id}`;
    return emoji.optionallyDiverseSequence?.trim() || emoji.name?.trim() || "";
}

function stop(e: React.SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
}

function contain(e: React.SyntheticEvent) {
    e.stopPropagation();
}

function react(channel: Channel, message: Message, emoji: EmojiSelectPayload | null) {
    const value = emojiValue(emoji);
    if (!value) return;

    RestAPI.put({ url: Constants.Endpoints.REACTION(channel.id, message.id, value, "@me") }).catch(err => {
        logger.error("could not react", err);
        showToast("Could not add that reaction", Toasts.Type.FAILURE);
    });
}

function Composer({ channel, close }: { channel: Channel; close: () => void; }) {
    const [value, setValue] = useState("");
    const [sending, setSending] = useState(false);

    const send = async () => {
        const content = value.trim();
        if (!content || sending) return;

        setSending(true);
        try {
            await sendMessage(channel.id, { content });
            close();
        } catch (err) {
            logger.error("could not send", err);
            showToast("Could not send that message", Toasts.Type.FAILURE);
            setSending(false);
        }
    };

    return <textarea
        className={cl("reply")}
        autoFocus
        rows={1}
        value={value}
        disabled={sending}
        placeholder="Message"
        onChange={e => setValue(e.currentTarget.value)}
        onKeyDown={e => {
            if (e.key === "Escape") return close();
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            send();
        }}
    />;
}

interface PopoutActionProps {
    label: string;
    icon: string;
    onToggle(open: boolean): void;
    renderPopout(close: () => void): React.ReactNode;
}

function PopoutAction({ label, icon, onToggle, renderPopout }: PopoutActionProps) {
    const trigger = useRef<HTMLButtonElement>(null);
    const [shown, setShown] = useState(false);

    const toggle = (next: boolean) => {
        if (next === shown) return;
        setShown(next);
        onToggle(next);
    };

    return <Popout
        position="bottom"
        align="right"
        targetElementRef={trigger}
        shouldShow={shown}
        onRequestClose={() => toggle(false)}
        renderPopout={() => <div onClick={contain} onMouseDown={contain}>{renderPopout(() => toggle(false))}</div>}
    >
        {() => <button
            ref={trigger}
            className={cl("action")}
            aria-label={label}
            onClick={e => {
                stop(e);
                toggle(!shown);
            }}
        >
            <svg width={14} height={14} viewBox="0 0 24 24"><path fill="currentColor" d={icon} /></svg>
        </button>}
    </Popout>;
}

const REPLY_ICON = "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z";
const REACT_ICON = "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM12 18a5.5 5.5 0 0 0 5-3.2 1 1 0 0 0-1.8-.9A3.5 3.5 0 0 1 12 16a3.5 3.5 0 0 1-3.2-2.1 1 1 0 1 0-1.8.9A5.5 5.5 0 0 0 12 18Z";
const READ_ICON = "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z";

export function Actions({ channel }: { channel: Channel; }) {
    const { quickReply, quickReact, markReadButton } = settings.use(["quickReply", "quickReact", "markReadButton"]);
    const message = useLastMessage(channel.id);
    const unread = useStateFromStores([ReadStateStore], () => ReadStateStore.hasUnread(channel.id));
    const [open, setOpen] = useState(0);

    const onToggle = (next: boolean) => setOpen(n => n + (next ? 1 : -1));
    const canReact = quickReact && message;
    const canMarkRead = markReadButton && unread;
    if (!quickReply && !canReact && !canMarkRead) return null;

    return <div className={cl("actions", { "actions-open": open > 0 })}>
        {quickReply && <PopoutAction
            label="Reply without opening the conversation"
            icon={REPLY_ICON}
            onToggle={onToggle}
            renderPopout={close => <Composer channel={channel} close={close} />}
        />}
        {canReact && <PopoutAction
            label="React to the last message"
            icon={REACT_ICON}
            onToggle={onToggle}
            renderPopout={close => <ReactionEmojiPicker
                channel={channel}
                closePopout={close}
                onSelectEmoji={({ emoji, willClose }: { emoji: EmojiSelectPayload | null; willClose: boolean; }) => {
                    react(channel, message, emoji);
                    if (willClose) close();
                }}
            />}
        />}
        {canMarkRead && <button
            className={cl("action")}
            aria-label="Mark as read"
            onClick={e => {
                stop(e);
                ReadStateUtils.ackChannel(channel);
            }}
        >
            <svg width={14} height={14} viewBox="0 0 24 24"><path fill="currentColor" d={READ_ICON} /></svg>
        </button>}
    </div>;
}
