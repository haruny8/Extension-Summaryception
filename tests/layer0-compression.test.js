import { describe, expect, it } from 'vitest';

import { defaultSettings } from '../src/foundation/constants.js';
import { resolveCallProfile } from '../src/core/call-profile.js';
import {
    appendLayer0PromptConstraints,
    getLayer0SummaryTokenTarget,
} from '../src/core/layer0-compression.js';
import {
    EXECUTION_TRIGGER_L0,
    EXECUTION_TRIGGER_PROMO,
    buildUserPrompt,
} from '../src/foundation/prompt-parts.js';

function makeLayer0Prompt(triggerLine) {
    return buildUserPrompt({
        inputBlocks: '<source>chat</source>',
        schemaBlock: 'schema',
        taskRules: 'rules',
        criticalRules: '',
        triggerLine,
    });
}

describe('getLayer0SummaryTokenTarget', () => {
    it('clamps a too-large target down and a too-small one up, preserving ordering', () => {
        const tooSmall = getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: -50 });
        const valid = getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 200 });
        const tooLarge = getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 100000 });
        expect(tooSmall).toBeLessThanOrEqual(valid);
        expect(valid).toBeLessThanOrEqual(tooLarge);
    });

    it('clamps two enormous targets to the same ceiling value', () => {
        const huge = getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 100000 });
        const alsoHuge = getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 500000 });
        expect(huge).toBe(alsoHuge);
        expect(huge).toBe(4000);
    });

    it('allows a target at the new 4k maximum', () => {
        expect(getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 4000 })).toBe(4000);
    });

    it('rounds a valid mid-range value through', () => {
        expect(getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 199.4 })).toBe(199);
    });

    it('falls back to the default setting for a non-finite target', () => {
        expect(getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: NaN })).toBe(
            defaultSettings.layer0SummaryTokenTarget,
        );
    });
});

describe('appendLayer0PromptConstraints', () => {
    const settings = { layer0SummaryTokenTarget: 200 };

    it('returns the prompt unchanged when the call is not a compression call', () => {
        const prompt = makeLayer0Prompt(EXECUTION_TRIGGER_L0);
        expect(
            appendLayer0PromptConstraints(
                prompt,
                settings,
                resolveCallProfile(settings, { kind: 'context-estimate' }),
            ),
        ).toBe(prompt);
    });

    it('inserts the narrative budget hint before the trigger and preserves L0 trigger finality', () => {
        const prompt = makeLayer0Prompt(EXECUTION_TRIGGER_L0);
        const result = appendLayer0PromptConstraints(
            prompt,
            settings,
            resolveCallProfile(settings, { kind: 'layer0' }),
        );
        expect(result).toContain('<summaryception_source_budget>');
        expect(result).toContain('<narrative>');
        expect(result).not.toContain('[STATE]');
        expect(result.trimEnd().endsWith(EXECUTION_TRIGGER_L0)).toBe(true);
    });

    it('does not add a redundant source-range sentence when sourceRange is present', () => {
        const prompt = makeLayer0Prompt(EXECUTION_TRIGGER_L0);
        const result = appendLayer0PromptConstraints(
            prompt,
            settings,
            resolveCallProfile(settings, { kind: 'layer0', sourceRange: [12, 34] }),
        );
        expect(result).not.toContain('This passage covers chat messages');
        expect(result).not.toContain('current_date_time must be the scene time');
        expect(result.trimEnd().endsWith(EXECUTION_TRIGGER_L0)).toBe(true);
    });

    it('uses the editable source-budget prompt and expands its dynamic macros', () => {
        const prompt = makeLayer0Prompt(EXECUTION_TRIGGER_L0);
        const result = appendLayer0PromptConstraints(
            prompt,
            {
                ...settings,
                layer0SourceBudgetPrompt:
                    'Keep it compact. Target {{target_tokens}} tokens and {{sentence_cap}} sentences.',
            },
            resolveCallProfile(settings, { kind: 'layer0' }),
        );
        expect(result).toContain('Keep it compact. Target 200 tokens and 7 sentences.');
        expect(result.trimEnd().endsWith(EXECUTION_TRIGGER_L0)).toBe(true);
    });

    it('delegates promotion calls to the promotion path, differing from input and keeping the promotion trigger', () => {
        const prompt = makeLayer0Prompt(EXECUTION_TRIGGER_PROMO);
        const result = appendLayer0PromptConstraints(
            prompt,
            settings,
            resolveCallProfile(settings, { kind: 'promotion', layerIndex: 0 }),
        );
        expect(result).not.toBe(prompt);
        expect(result).toContain(EXECUTION_TRIGGER_PROMO);
    });
});
