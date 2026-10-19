import { isTraceEnabled, trace } from '../foundation/logger.js';
import { getEffectiveSettings } from '../foundation/settings.js';
import { appendLayer0PromptConstraints } from './layer0-compression.js';
import { resolveCallProfile } from './call-profile.js';
import { countTextTokens, formatTokenCount } from './token-count.js';

/**
 * @typedef {object} SummarizerPipelineInputRequest
 * @property {string} storyTxt - The story text to summarize
 * @property {string} contextStr - The accumulated context string
 * @property {import('./call-profile.js').SummarizerCallMetadata} [metadata] - Resolver input: call category plus provenance
 * @property {ExtensionSettings} [settings] - Effective settings override
 */

/**
 * Resolve the call profile once at dispatch and render its prompts. The
 * returned profile is frozen policy: the runner consumes it instead of
 * re-deriving per-attempt decisions from the live settings.
 * @param {SummarizerPipelineInputRequest} request
 * @returns {Promise<{ prompt: string, repairPrompt: string, profile: import('./call-profile.js').CallProfile }>}
 */
export async function buildSummarizerPipelineInput({
    storyTxt,
    contextStr,
    metadata = {},
    settings = getEffectiveSettings(),
}) {
    const call = await buildUsageMetadata(metadata, storyTxt);
    const profile = resolveCallProfile(settings, call);
    const prompt = buildSummarizerPrompt({
        template: profile.policy.userPromptTemplate,
        storyTxt,
        contextStr,
        messageCount: getMessageCount(call, storyTxt),
        settings,
        profile,
    });
    const repairPrompt = profile.policy.repairPromptTemplate
        ? buildSummarizerPrompt({
              template: profile.policy.repairPromptTemplate,
              storyTxt,
              contextStr,
              messageCount: getMessageCount(call, storyTxt),
              settings,
              profile,
          })
        : '';

    return {
        prompt,
        repairPrompt,
        profile,
    };
}

/**
 * @param {string} storyTxt - Story text
 * @param {string} contextStr - Context text
 * @returns {Promise<void>}
 */
export async function traceSummarizerInputTokens(storyTxt, contextStr) {
    if (!isTraceEnabled()) {
        return;
    }

    const [storyTokens, contextTokens] = await Promise.all([
        countTextTokens(storyTxt || ''),
        countTextTokens(contextStr || ''),
    ]);

    trace('  storyTxt tokens:', formatTokenCount(storyTokens));
    trace('  contextStr tokens:', formatTokenCount(contextTokens));
}

/**
 * Add usage-only details that should not affect prompt labels or routing.
 * @param {import('./call-profile.js').SummarizerCallMetadata} metadata - Call metadata
 * @param {string} storyTxt - Source text being summarized
 * @returns {Promise<import('./call-profile.js').SummarizerCallMetadata>}
 */
async function buildUsageMetadata(metadata = {}, storyTxt = '') {
    let usageMetadata = metadata;

    if (metadata.kind === 'promotion' && !Number.isFinite(Number(metadata.memoryTokensBefore))) {
        const memoryTokens = await countTextTokens(storyTxt || '');
        usageMetadata = {
            ...usageMetadata,
            memoryTokensBefore: memoryTokens.count,
            memoryTokensBeforeEstimated: memoryTokens.estimated,
        };
    }

    if (!hasSourceTokenMetadata(usageMetadata)) {
        const sourceTokens = await countTextTokens(storyTxt || '');
        usageMetadata = {
            ...usageMetadata,
            sourceTokensBefore: sourceTokens.count,
            sourceTokensBeforeEstimated: sourceTokens.estimated,
        };
    }

    return usageMetadata;
}

function hasSourceTokenMetadata(metadata = {}) {
    return (
        Number.isFinite(Number(metadata.sourceTokensBefore)) ||
        Number.isFinite(Number(metadata.regexStats?.finalTokens)) ||
        Number.isFinite(Number(metadata.memoryTokensBefore))
    );
}

/**
 * Resolve the number of source items represented in this request.
 * @param {import('./call-profile.js').CallProvenance} metadata
 * @param {string} storyTxt
 * @returns {number}
 */
function getMessageCount(metadata, storyTxt) {
    if (
        typeof metadata.messageCount === 'number' &&
        Number.isInteger(metadata.messageCount) &&
        metadata.messageCount >= 0
    ) {
        return metadata.messageCount;
    }
    if (
        typeof metadata.mergedSnippetCount === 'number' &&
        Number.isInteger(metadata.mergedSnippetCount) &&
        metadata.mergedSnippetCount >= 0
    ) {
        return metadata.mergedSnippetCount;
    }
    return (String(storyTxt || '').match(/<msg\b/g) || []).length;
}

/**
 * @param {object} p
 * @param {string} p.template - User prompt template
 * @param {string} p.storyTxt - Story text
 * @param {string} p.contextStr - Context text
 * @param {number} p.messageCount - Number of source items represented in the request
 * @param {ExtensionSettings} p.settings - Active settings
 * @param {import('./call-profile.js').CallProfile} p.profile - Resolved call profile
 * @returns {string}
 */
function buildSummarizerPrompt({
    template,
    storyTxt,
    contextStr,
    messageCount,
    settings,
    profile,
}) {
    // replaceAll on purpose: every placeholder occurrence is replaced; user templates may repeat one.
    const prompt = template
        .replaceAll('{{context_str}}', contextStr || '(none yet)')
        .replaceAll('{{message_count}}', String(messageCount))
        .replaceAll('{{story_txt}}', storyTxt);
    return appendLayer0PromptConstraints(prompt, settings, profile);
}
