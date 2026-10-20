import { NOTIFY_EVENTS } from '../foundation/constants.js';
import { warn } from '../foundation/logger.js';
import { getChatStore } from '../foundation/chat-store.js';
import { buildInjection, measureInjection } from './memory-injection.js';
import { buildHypotheticalLayersAfterPromotion } from './promotion-planner.js';
import {
    formatSnippetAnchor,
    parseSnippet,
    stripLeadingSnippetAnchor,
} from './snippet-metadata.js';
import { formatTokenValue } from './token-count.js';

/**
 * Generate one validated promotion snippet: request the merge, validate its
 * narrative shape, and require the result to compress the live store's memory.
 * @param {object} prepared - Request-facing promotion fields (no snapshot).
 * @param {number} prepared.layerIndex - Promotion SOURCE layer.
 * @param {number} prepared.mergeCount
 * @param {ExtensionSettings} prepared.settings
 * @param {Array<object>} prepared.toMerge
 * @param {string} prepared.sourceNarrativeText
 * @param {{ count: number, estimated: boolean }} prepared.memoryTokensBefore
 * @param {string} prepared.storyTxt
 * @param {string} prepared.contextStr
 * @param {object} prepared.promotedMetadata
 * @param {object} prepared.promotionMetadata
 * @param {object} p
 * @param {import('./notify.js').NotifyAdapter} [p.notify] - Notify adapter; runs without one stay silent.
 * @param {import('./summarizer-request.js').SummarizerDispatch['call']} p.dispatch - Summarizer Dispatch both requests go through.
 * @param {AbortSignal} [p.signal] - Aborts the promotion request.
 * @returns {Promise<object | null>} The promoted snippet, or null when rejected.
 */
export async function generateValidatedPromotion(prepared, { notify, dispatch, signal }) {
    notify?.transient({
        kind: NOTIFY_EVENTS.PROMOTION_STARTED,
        mergedCount: prepared.toMerge.length,
        fromLayer: prepared.layerIndex,
        toLayer: prepared.layerIndex + 1,
    });

    if (!prepared.storyTxt) {
        return null;
    }

    const metaOutcome = await dispatch({
        storyTxt: prepared.storyTxt,
        contextStr: prepared.contextStr,
        metadata: prepared.promotionMetadata,
        notify,
        signal,
    });
    if (metaOutcome.status !== 'completed' || signal?.aborted) {
        return null;
    }

    return await buildValidatedPromotionSnippet({
        prepared,
        narrative: metaOutcome.text,
    });
}

async function buildValidatedPromotionSnippet({ prepared, narrative }) {
    const { layerIndex, mergeCount, settings, promotedMetadata } = prepared;
    const firstCandidate = buildPromotionCandidate(narrative, promotedMetadata);
    if (!firstCandidate) {
        return null;
    }

    const firstValidation = await validatePromotionCandidate({
        layerIndex,
        mergeCount,
        promotedSnippet: firstCandidate,
        settings,
    });
    if (firstValidation.valid) {
        return firstCandidate;
    }

    return null;
}

function buildPromotionCandidate(narrative, promotedMetadata) {
    const metaSummary = parseSnippet(narrative).narrative.trim();
    if (!metaSummary) {
        return null;
    }
    const cleanSummary = formatSnippetAnchor(promotedMetadata)
        ? stripLeadingSnippetAnchor(metaSummary)
        : metaSummary;
    if (!cleanSummary) {
        return null;
    }
    return { text: cleanSummary, ...promotedMetadata };
}

async function validatePromotionCandidate({ layerIndex, mergeCount, promotedSnippet, settings }) {
    return validatePromotionCompressesMemory({ layerIndex, mergeCount, promotedSnippet, settings });
}

async function validatePromotionCompressesMemory({
    layerIndex,
    mergeCount,
    promotedSnippet,
    settings,
}) {
    const store = getChatStore();
    const memoryTokensBefore = await measureInjection(buildInjection(store.layers, settings));
    const nextLayers = buildHypotheticalLayersAfterPromotion(
        store.layers,
        layerIndex,
        mergeCount,
        promotedSnippet,
    );
    const memoryTokensAfter = await measureInjection(buildInjection(nextLayers, settings));
    if (memoryTokensAfter.total.count < memoryTokensBefore.total.count) {
        return { valid: true };
    }
    warn(
        `Promotion L${layerIndex} rejected: memory did not compress ` +
            `(${formatTokenValue(
                memoryTokensBefore.total.count,
                memoryTokensBefore.total.estimated,
            )}->` +
            `${formatTokenValue(
                memoryTokensAfter.total.count,
                memoryTokensAfter.total.estimated,
            )} tokens).`,
    );
    return { valid: false, reason: 'memory-total' };
}
