import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearChatData } from '../src/core/chat-data.js';
import { initRefreshPort } from '../src/foundation/refresh.js';
import { installSummaryContext, makeMessage, makeSummaryStore } from './test-helpers.js';

/**
 * One chat carrying the extension's active chat data, plus a foreign extra
 * that happens to start with `sc_` and an unrelated chat-metadata key. The
 * foreign extra is the pin on the retired prefix sweep (ADR-0027).
 */
function installDirtyChat() {
    const commands = [];
    const saveMetadata = vi.fn();
    const saveChat = vi.fn();
    const chat = [
        {
            ...makeMessage({ isUser: true, scId: 'user-id' }),
            extra: {
                api: 'keep',
                sc_ghosted: true,
                sc_token_count: { textLength: 5, rawTokens: 5, finalTokens: 5 },
            },
        },
        {
            ...makeMessage({ scId: 'assistant-id' }),
            extra: { reasoning: 'keep' },
        },
    ];
    const store = makeSummaryStore({
        layers: [[{ text: 'summary', sourceMessageIds: ['user-id', 'assistant-id'] }]],
        ghostedMessageIds: ['user-id', 'assistant-id'],
    });
    const ctx = installSummaryContext({
        chat,
        metadata: { summaryception: store, unrelated: { keep: true } },
        executeSlashCommandsWithOptions: async (command) => commands.push(command),
        saveMetadata,
        saveChat,
    });
    return { commands, saveMetadata, saveChat, chat, store, ctx };
}

afterEach(() => {
    delete globalThis.SillyTavern;
});

describe('clearChatData', () => {
    it('removes every shape of Extension Chat Data, unhides the chat, and writes the file once', async () => {
        const { commands, saveMetadata, saveChat, chat, store, ctx } = installDirtyChat();

        await clearChatData();

        // Ghosting: the host full-range unhide ran and ownership was released.
        expect(commands).toEqual(['/unhide 0-1']);
        // The Chat Store is emptied in place, never deleted and recreated.
        expect(ctx.chatMetadata.summaryception).toBe(store);
        expect(store.layers).toEqual([]);
        expect(store.ghostedMessageIds).toEqual([]);
        expect(store.mutationEpoch).toBeGreaterThan(0);
        expect(ctx.chatMetadata.unrelated).toEqual({ keep: true });
        expect(chat.every((message) => !Object.hasOwn(message, 'sc_id'))).toBe(true);
        expect(chat[0].extra).toEqual({ api: 'keep', sc_ghosted: true });
        expect(chat[1].extra).toEqual({ reasoning: 'keep' });
        // One chat-file write, from the one writer.
        expect(saveChat).toHaveBeenCalledTimes(1);
        expect(saveMetadata).toHaveBeenCalled();
    });

    it('is idempotent: a re-run over the emptied chat leaves it clean', async () => {
        const { commands, chat, store, ctx } = installDirtyChat();

        await clearChatData();
        await clearChatData();

        expect(commands).toEqual(['/unhide 0-1', '/unhide 0-1']);
        expect(ctx.chatMetadata.summaryception).toBe(store);
        expect(store.layers).toEqual([]);
        expect(store.ghostedMessageIds).toEqual([]);
        expect(chat.every((message) => !Object.hasOwn(message, 'sc_id'))).toBe(true);
        expect(chat[1].extra).toEqual({ reasoning: 'keep' });
    });

    it('re-renders the visible state and the injections from the wiped chat', async () => {
        installDirtyChat();
        const port = {
            updateInjection: vi.fn(),
            updateUI: vi.fn(),
            updatePreview: vi.fn(),
        };
        initRefreshPort(port);

        await clearChatData();

        expect(port.updateInjection).toHaveBeenCalled();
        expect(port.updateUI).toHaveBeenCalled();
    });
});
