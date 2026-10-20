import { defaultSettings } from '../foundation/constants.js';

export const LAYER_SAFETY_MULTIPLIER = { l0: 0.85, l1: 0.5, l2: 0.5 };

/**
 * Source token count above which a summarizer output must clear a minimum
 * narrative size (integrity check and Layer 0 narrative minimum gating).
 */
export const SUBSTANTIAL_SOURCE_TOKEN_THRESHOLD = 500;

const ADVISORY_TOKENS_PER_SENTENCE = 35;
const ADVISORY_LAYER0_SIZE_FACTOR = 1.5 * 0.85;

/**
 * Build the Layer 0 model-countable source budget block.
 * @param {object} p
 * @param {number} p.targetTokens
 * @param {string} [p.template]
 * @returns {string}
 */
export function buildLayer0BudgetHint({
    targetTokens,
    template = defaultSettings.layer0SourceBudgetPrompt,
}) {
    const resolvedTarget = Number.isFinite(Number(targetTokens))
        ? Math.round(Number(targetTokens))
        : defaultSettings.layer0SummaryTokenTarget;
    const sentenceCap = Math.max(
        1,
        Math.floor((resolvedTarget * ADVISORY_LAYER0_SIZE_FACTOR) / ADVISORY_TOKENS_PER_SENTENCE),
    );
    const body = String(template ?? '')
        .replaceAll('{{sentence_cap}}', String(sentenceCap))
        .replaceAll('{{target_tokens}}', String(resolvedTarget));
    return ['<summaryception_source_budget>', body, '</summaryception_source_budget>'].join('\n');
}

/**
 * Resolve the source-side token count for a summarizer call.
 * @param {import('./call-profile.js').CallProvenance} [provenance]
 * @returns {number}
 */
export function getSourceTokenCount(provenance = {}) {
    const candidates = [
        provenance.sourceTokensBefore,
        provenance.regexStats?.finalTokens,
        provenance.memoryTokensBefore,
    ];
    for (const value of candidates) {
        const count = Number(value);
        if (Number.isFinite(count) && count > 0) {
            return count;
        }
    }
    return 0;
}

/** Overhead of the surrounding SillyTavern prompt in the main-request preview. */
const PREVIEW_BASE_PROMPT_OVERHEAD = 2000;
/** Fixed allowance for deep-layer snippets in the L1 preview line. */
const PREVIEW_DEEP_MEMORY_OVERHEAD = 1000;

/**
 * Estimate the injected-context sizes shown by the settings preview panel.
 * @param {ReturnType<typeof import('../foundation/settings.js').getSettings>} settings
 * @returns {{ rawChatMin: number, rawChatMax: number, mainMin: number, mainMax: number, l0Typical: number, l0Max: number, l1Total: number }}
 */
export function estimateContextPreview(settings) {
    const memoryBudget = readTokenSetting(settings, 'memoryTokenBudget');
    const verbatimBudget = readTokenSetting(settings, 'verbatimTokenBudget');
    const queuedBudget = readTokenSetting(settings, 'queuedTokenBudget');
    const minL0Source = readTokenSetting(settings, 'minSummaryBudget');
    const maxL0Source = readTokenSetting(settings, 'maxL0SourceTokens');
    const snippetsPerPromotion = readTokenSetting(settings, 'snippetsPerPromotion');
    const summaryTarget = readTokenSetting(settings, 'layer0SummaryTokenTarget');
    return {
        rawChatMin: verbatimBudget,
        rawChatMax: verbatimBudget + queuedBudget,
        mainMin: memoryBudget + verbatimBudget,
        mainMax: memoryBudget + verbatimBudget + queuedBudget,
        l0Typical: minL0Source + memoryBudget + PREVIEW_BASE_PROMPT_OVERHEAD,
        l0Max: maxL0Source + memoryBudget + PREVIEW_BASE_PROMPT_OVERHEAD,
        l1Total:
            snippetsPerPromotion * summaryTarget +
            Math.round(memoryBudget * LAYER_SAFETY_MULTIPLIER.l1) +
            PREVIEW_DEEP_MEMORY_OVERHEAD,
    };
}

/**
 * Read a numeric token setting, falling back to its default when unset or invalid.
 * @param {object} settings
 * @param {string} key
 * @returns {number}
 */
function readTokenSetting(settings, key) {
    const number = Number(settings[key]);
    return Number.isFinite(number) ? number : defaultSettings[key];
}
