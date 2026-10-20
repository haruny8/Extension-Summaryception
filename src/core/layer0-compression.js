import { defaultSettings, SLIDER_LIMITS } from '../foundation/constants.js';
import { parseNarrativeEnvelope } from './structural-headers.js';
import {
    insertBeforeTrigger,
    EXECUTION_TRIGGER_L0,
    EXECUTION_TRIGGER_PROMO,
} from '../foundation/prompt-parts.js';
import { buildLayer0BudgetHint } from './token-budget.js';

/** After the close tag only whitespace or one scene-time key line is legal. */
const SCENE_TIME_TAIL_LINE_RE = /^[^\S\r\n]*current_date_time[^\S\r\n]*[:=][^\S\r\n]*\S/i;

/**
 * Normalize the configured Layer 0 summary target.
 * @param {Partial<ExtensionSettings>} [settings]
 * @returns {number}
 */
export function getLayer0SummaryTokenTarget(settings = {}) {
    const parsed = Number(settings.layer0SummaryTokenTarget);
    const fallback = defaultSettings.layer0SummaryTokenTarget;
    const value = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
    const { MIN, MAX } = SLIDER_LIMITS.layer0SummaryTokenTarget;
    return Math.min(MAX, Math.max(MIN, value));
}

/**
 * Isolate the enveloped narrative body of a Layer 0 draft: the prose between
 * the <narrative> open and close tags.
 * @param {string} text - Cleaned summarizer output
 * @returns {string}
 */
export function extractLayer0Narrative(text) {
    const envelope = parseNarrativeEnvelope(text);
    return envelope ? envelope.body.trim() : '';
}

/**
 * Check the structural contract for a Layer 0 draft: one <narrative> envelope
 * starting the output, a non-empty body between the tags, and after the close
 * tag only whitespace or one trailing scene-time line. The close tag is the
 * document-level contract: whatever prose follows it, the draft is rejected.
 * @param {string} text - Cleaned summarizer output
 * @returns {string} Empty string when valid; a short rejection reason otherwise
 */
export function validateLayer0Structure(text) {
    const envelope = parseNarrativeEnvelope(text);
    if (!envelope) {
        return 'missing <narrative> envelope';
    }
    if (envelope.tail.toLowerCase().includes('</narrative>')) {
        return 'duplicate </narrative>';
    }
    if (!envelope.body.trim()) {
        return 'empty <narrative> body';
    }
    const tailLines = envelope.tail
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const sceneTimeLines = tailLines.filter((line) => SCENE_TIME_TAIL_LINE_RE.test(line));
    if (tailLines.length !== sceneTimeLines.length || sceneTimeLines.length > 1) {
        return 'prose after </narrative>';
    }
    return '';
}

/**
 * Add non-persisted compression constraints to the final prompt.
 * @param {string} prompt
 * @param {Partial<ExtensionSettings>} settings
 * @param {import('./call-profile.js').CallProfile} profile - Call profile resolved at dispatch
 * @returns {string}
 */
export function appendLayer0PromptConstraints(prompt, settings, profile) {
    if (!profile?.policy?.compression) {
        return prompt;
    }

    if (profile.policy.promotionConstraints) {
        return appendPromotionPromptConstraints(prompt, settings, profile.provenance);
    }

    if (!profile.policy.narrativeEnvelope) {
        return prompt;
    }

    const insert = [
        buildLayer0BudgetHint({
            targetTokens: getLayer0SummaryTokenTarget(settings),
            template: settings.layer0SourceBudgetPrompt,
        }),
    ]
        .filter(Boolean)
        .join('\n\n');
    return insertBeforeTrigger(prompt, insert, EXECUTION_TRIGGER_L0);
}

/**
 * @param {string} prompt
 * @param {Partial<ExtensionSettings>} settings
 * @param {import('./call-profile.js').SummarizerCallMetadata} metadata
 * @returns {string}
 */
function appendPromotionPromptConstraints(prompt, settings, metadata = {}) {
    const targetTokens = getLayer0SummaryTokenTarget(settings);
    const layerIndex = Number(metadata.layerIndex);
    const depthGuidance =
        layerIndex >= 1
            ? 'For this deep-layer fold, merge whole scenes into outcome-level prose and do not replay beats. '
            : '';
    const block = [
        '<summaryception_promotion_guidance>',
        `Aim for roughly ${targetTokens} tokens when the source supports it, but prioritize complete durable chronology over an exact length.`,
        `${depthGuidance}Keep only macro-level plot outcomes, lasting relationship or state changes, permanent rules, and unresolved hooks.`,
        '</summaryception_promotion_guidance>',
    ].join('\n');
    return insertBeforeTrigger(prompt, block, EXECUTION_TRIGGER_PROMO);
}
