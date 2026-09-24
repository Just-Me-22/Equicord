/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Channel, Emoji, Message } from "@vencord/discord-types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { Constants, DraftActions, DraftStore, DraftType, EmojiStore, IconUtils, MessageStore, Popout, ReadStateStore, ReadStateUtils, RestAPI, showToast, Toasts, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { displayName, getMessageContent } from "./content";
import { loadRecent, useLastMessage } from "./hooks";
import { settings } from "./settings";

const cl = classNameFactory("vc-message-peek-");
const logger = new Logger("MessagePeek");

const ReactionEmojiPicker = findComponentByCodeLazy<any>("showAddEmojiButton:", "pickerIntention:", "messageId:");
const ChannelTextArea = findComponentByCodeLazy<any>("editorClassName", "CHANNEL_TEXT_AREA");
const ChatInputTypes = findByPropsLazy("FORM", "USER_PROFILE_REPLY");
const MessageParser = findByPropsLazy("parse", "parsePreprocessor", "unparse");

const CONTEXT_SIZE = 3;
const QUICK_REACTIONS = 3;

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

const richOf = (text: string) => text.split("\n").map(line => ({ type: "line", children: [{ text: line }] }));

const nameOf = (message: Message) => message.author.id === UserStore.getCurrentUser()?.id ? "You" : displayName(message.author.id);

function Context({ channel }: { channel: Channel; }) {
    const messages = useStateFromStores(
        [MessageStore],
        () => (MessageStore.getMessages(channel.id)?._array ?? []).slice(-CONTEXT_SIZE),
        [channel.id],
        (a, b) => a.length === b.length && a.every((message, i) => message === b[i])
    );

    useEffect(() => {
        if (messages.length < CONTEXT_SIZE) loadRecent(channel.id, CONTEXT_SIZE);
    }, [channel.id]);

    return <div className={cl("context")}>
        {messages.map(message => {
            const content = getMessageContent(message);
            if (!content) return null;
            return <div key={message.id} className={cl("context-line")}>
                <span className={cl("context-name")}>{nameOf(message)}</span>{content.action ? " " : ": "}{content.text}
            </div>;
        })}
    </div>;
}

function Composer({ channel, close }: { channel: Channel; close: () => void; }) {
    const last = useLastMessage(channel.id);
    const [threaded, setThreaded] = useState(() => last != null && last.author.id !== UserStore.getCurrentUser()?.id);
    const [text, setText] = useState(() => DraftStore.getDraft(channel.id, DraftType.ChannelMessage) ?? "");
    const [rich, setRich] = useState(() => richOf(text));

    const submit = async ({ value }: { value: string; }) => {
        const content = value.trim();
        if (!content) return { shouldClear: false, shouldRefocus: true };

        try {
            await sendMessage(
                channel.id,
                MessageParser.parse(channel, content),
                true,
                threaded && last ? { messageReference: { channel_id: channel.id, message_id: last.id } } : {}
            );
            DraftActions.clearDraft(channel.id, DraftType.ChannelMessage);
            close();
            return { shouldClear: true, shouldRefocus: false };
        } catch (err) {
            logger.error("could not send", err);
            showToast("Could not send that message", Toasts.Type.FAILURE);
            return { shouldClear: false, shouldRefocus: true };
        }
    };

    return <div className={cl("composer")}>
        <Context channel={channel} />
        {last && <label className={cl("thread")}>
            <input type="checkbox" checked={threaded} onChange={e => setThreaded(e.currentTarget.checked)} />
            {last.author.id === UserStore.getCurrentUser()?.id ? "Reply to your message" : `Reply to ${displayName(last.author.id)}`}
        </label>}
        <ChannelTextArea
            className={cl("reply")}
            type={ChatInputTypes.USER_PROFILE_REPLY}
            channel={channel}
            placeholder="Message"
            textValue={text}
            richValue={rich}
            focused
            onChange={(_: unknown, nextText: string, nextRich: ReturnType<typeof richOf>) => {
                if (nextText === text) return;
                setText(nextText);
                setRich(nextRich);
                DraftActions.saveDraft(channel.id, nextText, DraftType.ChannelMessage);
            }}
            onSubmit={submit}
        />
    </div>;
}

const emojiImage = (emoji: Emoji) => "id" in emoji && emoji.id
    ? IconUtils.getEmojiURL({ id: emoji.id, animated: emoji.animated, size: 48 })
    : (emoji as Emoji & { url: string; }).url;

function ReactPicker({ channel, message, close }: { channel: Channel; message: Message; close: () => void; }) {
    const [full, setFull] = useState(false);
    const top = ((EmojiStore.emojiReactionFrecencyWithoutFetchingLatest as unknown as { frequently: Emoji[]; }).frequently ?? []).slice(0, QUICK_REACTIONS);

    if (full || !top.length) {
        return <ReactionEmojiPicker
            channel={channel}
            closePopout={close}
            onSelectEmoji={({ emoji, willClose }: { emoji: EmojiSelectPayload | null; willClose: boolean; }) => {
                react(channel, message, emoji);
                if (willClose) close();
            }}
        />;
    }

    return <div className={cl("quick-react")}>
        {top.map(emoji => <button
            key={emojiValue(emoji as EmojiSelectPayload)}
            className={cl("quick-emoji")}
            aria-label={`React with ${emoji.name}`}
            onClick={() => {
                react(channel, message, emoji as EmojiSelectPayload);
                close();
            }}
        >
            <img src={emojiImage(emoji)} alt="" />
        </button>)}
        <button className={cl("quick-emoji")} aria-label="More reactions" onClick={() => setFull(true)}>
            <svg width={18} height={18} viewBox="0 0 24 24"><path fill="currentColor" d={MORE_ICON} /></svg>
        </button>
    </div>;
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
export const READ_ICON = "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z";
const MORE_ICON = "M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z";

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
            renderPopout={close => <ReactPicker channel={channel} message={message} close={close} />}
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
