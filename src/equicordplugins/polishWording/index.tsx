/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import {
    MessageSendListener,
} from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin, { IconComponent, makeRange, OptionType } from "@utils/types";

const presendObject: MessageSendListener = (channelId, msg) => {
    msg.content = textProcessing(msg.content);
};

const settings = definePluginSettings({
    quickDisable: {
        type: OptionType.BOOLEAN,
        description: "Quick disable. Turns off message modifying without requiring a client reload.",
        default: false,
    },

    blockedWords: {
        type: OptionType.STRING,
        description: "Words that will not be capitalized (comma separated).",
        default: "",
    },
    fixApostrophes: {
        type: OptionType.BOOLEAN,
        description: "Ensure contractions contain apostrophes.",
        default: true,
    },
    expandContractions: {
        type: OptionType.BOOLEAN,
        description: "Expand contractions.",
        default: false,
    },
    fixCapitalization: {
        type: OptionType.BOOLEAN,
        description: "Capitalize sentences.",
        default: false,
    },
    fixPunctuation: {
        type: OptionType.BOOLEAN,
        description: "Punctate sentences.",
        default: false,
    },
    fixPunctuationFrequency: {
        type: OptionType.SLIDER,
        description: "Percent period frequency (this majorly annoys some people).",
        markers: makeRange(0, 100, 10),
        stickToMarkers: false,
        default: 100,
    }
});

const PolishWordingIcon: IconComponent = ({ height = 20, width = 20, className, children }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
            mask="url(#vc-polish-wording-mask)"
            d="M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H5Zm6.1 4h1.8l4.7 12h-2.6l-.95-2.5H9.95L9 18H6.4L11.1 6Zm.9 3.6-1.35 3.6h2.7L12 9.6Z"
        />
        {children}
    </svg>
);

function PolishWordingDisabledIcon() {
    return (
        <PolishWordingIcon>
            <mask id="vc-polish-wording-mask">
                <path fill="#fff" d="M0 0h24v24H0Z" />
                <path stroke="#000" strokeWidth="5.99068" d="M0 24 24 0" />
            </mask>
            <path fill="var(--status-danger)" d="m21.178 1.70703 1.414 1.414L4.12103 21.593l-1.414-1.415L21.178 1.70703Z" />
        </PolishWordingIcon>
    );
}

const PolishWordingToggle: ChatBarButtonFactory = ({ isMainChat }) => {
    const { quickDisable } = settings.use(["quickDisable"]);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={quickDisable ? "Enable PolishWording" : "Disable PolishWording"}
            onClick={() => settings.store.quickDisable = !quickDisable}
        >
            {quickDisable ? <PolishWordingDisabledIcon /> : <PolishWordingIcon />}
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "PolishWording",
    description: "Tweaks your messages to make them look nicer and have better grammar. See settings",
    dependencies: ["MessageEventsAPI", "ChatInputButtonAPI"],
    tags: ["Chat"],
    authors: [Devs.Samwich, EquicordDevs.WKoA],
    onBeforeMessageSend: presendObject,
    settings,

    chatBarButton: {
        icon: PolishWordingIcon,
        render: PolishWordingToggle
    }
});

function textProcessing(input: string) {
    if (settings.store.quickDisable) return input;

    let text = input;

    const codeBlockRegex = /```[\s\S]*?```|`[\s\S]*?`/g;
    const codeBlocks: string[] = [];
    text = text.replace(codeBlockRegex, match => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    if (settings.store.fixApostrophes || settings.store.expandContractions) text = ensureApostrophe(text);
    if (settings.store.fixCapitalization) text = capitalize(text);
    if (settings.store.fixPunctuation && (Math.random() * 100 < settings.store.fixPunctuationFrequency)) text = addPeriods(text);
    if (settings.store.expandContractions) text = expandContractions(text);

    text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => codeBlocks[parseInt(index)]);

    return text;
}

const contractionsMap: { [key: string]: string; } = {
    "wasn't": "was not",
    "can't": "cannot",
    "don't": "do not",
    "won't": "will not",
    "isn't": "is not",
    "aren't": "are not",
    "haven't": "have not",
    "hasn't": "has not",
    "hadn't": "had not",
    "doesn't": "does not",
    "didn't": "did not",
    "shouldn't": "should not",
    "wouldn't": "would not",
    "couldn't": "could not",
    "that's": "that is",
    "what's": "what is",
    "there's": "there is",
    "how's": "how is",
    "where's": "where is",
    "when's": "when is",
    "who's": "who is",
    "why's": "why is",
    "you'll": "you will",
    "i'll": "I will",
    "they'll": "they will",
    "it'll": "it will",
    "i'm": "I am",
    "you're": "you are",
    "they're": "they are",
    "he's": "he is",
    "she's": "she is",
    "i've": "I have",
    "you've": "you have",
    "we've": "we have",
    "they've": "they have",
    "could've": "could have",
    "would've": "would have",
    "should've": "should have",
    "might've": "might have",
    "you'd": "you would",
    "he'd": "he would",
    "she'd": "she would",
    "it'd": "it would",
    "we'd": "we would",
    "they'd": "they would",
    "y'all": "you all",
    "here's": "here is",
};

const ambiguousWithoutApostrophe = new Set(["ill", "shed", "wed"]);

const missingApostropheMap: { [key: string]: string; } = {};
for (const contraction in contractionsMap) {
    const withoutApostrophe = removeApostrophes(contraction.toLowerCase());
    if (ambiguousWithoutApostrophe.has(withoutApostrophe)) continue;

    missingApostropheMap[withoutApostrophe] = contraction;
}

function getCapData(str: string) {
    const booleanArray: boolean[] = [];
    for (const char of str) {
        if (char.match(/[a-zA-Z]/)) {
            booleanArray.push(char === char.toUpperCase());
        }
    }
    return booleanArray;
}

function restoreCap(str: string, data: boolean[]): string {
    let resultString = "";
    let dataIndex = 0;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (!char.match(/[a-zA-Z]/)) {
            resultString += char;
            continue;
        }

        const isUppercase = data[dataIndex];
        resultString += isUppercase ? char.toUpperCase() : char.toLowerCase();

        if (dataIndex < data.length - 1) dataIndex++;
    }

    return resultString;
}

function ensureApostrophe(textInput: string): string {

    const potentialContractions = Object.keys(missingApostropheMap);
    if (potentialContractions.length === 0) {
        return textInput;
    }

    const findMissingRegex = new RegExp(
        `\\b(${potentialContractions.join("|")})\\b`,
        "gi"
    );

    return textInput.replace(findMissingRegex, match => {
        const lowerCaseMatch = match.toLowerCase();

        if (Object.prototype.hasOwnProperty.call(missingApostropheMap, lowerCaseMatch)) {
            const correctContraction = missingApostropheMap[lowerCaseMatch];
            return restoreCap(correctContraction, getCapData(match));
        }
        return match;
    });
}

function expandContractions(textInput: string) {
    const contractionRegex = new RegExp(
        `\\b(${Object.keys(contractionsMap).join("|")})\\b`,
        "gi"
    );

    return textInput.replace(contractionRegex, (match, _contraction, offset: number, full: string) => {
        const lowerCaseMatch = match.toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(contractionsMap, lowerCaseMatch)) return match;

        let expansion = contractionsMap[lowerCaseMatch];

        if (expansion.endsWith(" is") && /^\s+been\b/i.test(full.slice(offset + match.length))) {
            expansion = `${expansion.slice(0, -3)} has`;
        }

        return restoreCap(expansion, getCapData(match));
    });
}

function removeApostrophes(str: string): string {
    return str.replace(/'/g, "");
}

function capitalize(textInput: string): string {

    const sentenceSplitRegex = /((?<!\w\.\w.)(?<!\b[A-Z][a-z]\.)(?<![A-Z]\.)(?<!\.)(?<=[.?!])\s+|\n+)/;

    const parts = textInput.split(sentenceSplitRegex);
    const filteredParts = parts.filter(part => part !== undefined && part !== null);

    const blockedWordsArray: string[] = (settings.store.blockedWords || "")
        .split(/,\s?/)
        .filter(bw => bw)
        .map(bw => bw.toLowerCase());

    let result = "";
    for (let i = 0; i < filteredParts.length; i++) {
        const element = filteredParts[i];

        const isSentence = !sentenceSplitRegex.test(element);

        if (isSentence) {
            if (!element) continue;
            else if (element.trim() === "") {
                result += element;
                continue;
            }

            const firstWordMatch = element.match(/^\s*([\w'-]+)/);
            const firstWord = firstWordMatch ? firstWordMatch[1].toLowerCase() : "";
            const isBlocked = firstWord ? blockedWordsArray.includes(firstWord) : false;

            if (
                !isBlocked &&
                !element.startsWith("http")
            ) {
                result += element.replace(/^(\s*)(\S)/, (match, leadingSpace, firstChar) => {
                    return leadingSpace + firstChar.toUpperCase();
                });
            } else {
                result += element;
            }
        } else {
            if (element) {
                result += element;
            }
        }
    }

    result = result.replace(/\bi\b(?!\s+is\b)(?=['\s]|$)/g, "I");

    return result;
}

function addPeriods(textInput: string) {
    if (!textInput) {
        return "";
    }

    const lines = textInput.split("\n");
    const processedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const strippedLine = line.trimEnd();

        const urlRegex = /https?:\/\/\S+$|www\.\S+$/;

        if (!strippedLine) {
            if (i < lines.length - 1) {
                processedLines.push("");
            }

        } else {
            const lastChar = strippedLine.slice(-1);
            if (
                /[A-Za-z0-9]/.test(lastChar) &&
                !urlRegex.test(strippedLine)
            ) {
                processedLines.push(strippedLine + ".");
                continue;
            }

            processedLines.push(strippedLine);

        }
    }

    return processedLines.join("\n");
}
