// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

export interface ChatMessagePart {
    // What is the format for these?
}

export default interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ChatMessagePart[];
}