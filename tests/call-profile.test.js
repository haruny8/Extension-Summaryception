import { describe, expect, it } from 'vitest';

import { defaultSettings, UI_MODES } from '../src/foundation/constants.js';
import { resolveCallProfile } from '../src/core/call-profile.js';
import { makeSummarySettings } from './test-helpers.js';

describe('resolveCallProfile prompts', () => {
    const promptSettings = makeSummarySettings({
        summarizerSystemPrompt: 'L0-SYS',
        summarizerUserPrompt: 'L0-USER',
        promotionSystemPrompt: 'PROMO-SYS',
        promotionUserPrompt: 'PROMO-USER',
        summarizerRepairPrompt: 'L0-REPAIR',
        summarizerSystemPromptPreset: 'custom',
        promptPreset: 'custom',
        summarizerRepairPromptPreset: 'custom',
        promotionSystemPromptPreset: 'custom',
        promotionPromptPreset: 'custom',
    });

    it('routes each call family to its own prompt settings', () => {
        const layer0 = resolveCallProfile(promptSettings, { kind: 'layer0' }).policy;
        expect(layer0.systemPrompt).toBe('L0-SYS');
        expect(layer0.userPromptTemplate).toBe('L0-USER');

        const regenerate = resolveCallProfile(promptSettings, { kind: 'regenerate' }).policy;
        expect(regenerate.systemPrompt).toBe('L0-SYS');
        expect(regenerate.userPromptTemplate).toBe('L0-USER');

        const promotion = resolveCallProfile(promptSettings, { kind: 'promotion' }).policy;
        expect(promotion.systemPrompt).toBe('PROMO-SYS');
        expect(promotion.userPromptTemplate).toBe('PROMO-USER');
    });

    it('falls back to the default prompts for malformed non-string settings', () => {
        const broken = makeSummarySettings({
            summarizerSystemPrompt: 42,
        });
        expect(resolveCallProfile(broken, { kind: 'layer0' }).policy.systemPrompt).toBe(
            defaultSettings.summarizerSystemPrompt,
        );
    });

    it('carries an intentionally empty prompt string through without substituting the default', () => {
        const policy = resolveCallProfile(
            makeSummarySettings({ promptPreset: 'custom', summarizerUserPrompt: '' }),
            { kind: 'layer0' },
        ).policy;
        expect(policy.userPromptTemplate).toBe('');
    });

    it('uses the selected default at runtime while keeping custom text available', () => {
        const settings = makeSummarySettings({
            promptPreset: 'narrative',
            summarizerUserPrompt: 'saved custom draft',
        });

        expect(resolveCallProfile(settings, { kind: 'layer0' }).policy.userPromptTemplate).toBe(
            defaultSettings.summarizerUserPrompt,
        );

        settings.promptPreset = 'custom';
        expect(resolveCallProfile(settings, { kind: 'layer0' }).policy.userPromptTemplate).toBe(
            'saved custom draft',
        );
    });

    it('resolves the repair template for the layer0 family only', () => {
        expect(
            resolveCallProfile(promptSettings, { kind: 'layer0' }).policy.repairPromptTemplate,
        ).toBe('L0-REPAIR');
        expect(
            resolveCallProfile(promptSettings, { kind: 'regenerate' }).policy.repairPromptTemplate,
        ).toBe('L0-REPAIR');
        expect(
            resolveCallProfile(promptSettings, { kind: 'promotion' }).policy.repairPromptTemplate,
        ).toBe('');
    });
});

describe('resolveCallProfile route timeouts', () => {
    it('reads each route from its own settings field and applies the full window', () => {
        const settings = makeSummarySettings({
            requestTimeoutSeconds: 30,
            mergeRequestTimeoutSeconds: 40,
            fallbackConnectionSource: 'profile',
            fallbackRequestTimeoutSeconds: 50,
        });
        const layer0 = resolveCallProfile(settings, { kind: 'layer0' }).policy.routes;
        expect(layer0[0].timeoutMs).toBe(30000);
        expect(layer0[1].timeoutMs).toBe(50000);

        const promotion = resolveCallProfile(settings, { kind: 'promotion' }).policy.routes;
        expect(promotion[0].timeoutMs).toBe(40000);
        expect(promotion[1].timeoutMs).toBe(50000);
    });

    it('applies the per-family hard fallback when the setting is not a positive number', () => {
        for (const overrides of [
            {},
            { requestTimeoutSeconds: 0 },
            { mergeRequestTimeoutSeconds: -5 },
            { fallbackRequestTimeoutSeconds: Number.NaN },
        ]) {
            const settings = makeSummarySettings({
                fallbackConnectionSource: 'profile',
                ...overrides,
            });
            const layer0 = resolveCallProfile(settings, { kind: 'layer0' }).policy.routes;
            expect(layer0[0].timeoutMs).toBe(120000);
            expect(layer0[1].timeoutMs).toBe(120000);

            const promotion = resolveCallProfile(settings, { kind: 'promotion' }).policy.routes;
            expect(promotion[0].timeoutMs).toBe(90000);
            expect(promotion[1].timeoutMs).toBe(90000);
        }
    });
});

describe('resolveCallProfile health bucket', () => {
    it('splits promotion from the layer0 family so retries never influence each other', () => {
        const settings = makeSummarySettings();
        expect(resolveCallProfile(settings, { kind: 'promotion' }).policy.healthBucket).toBe(
            'l1plus',
        );
        expect(resolveCallProfile(settings, { kind: 'layer0' }).policy.healthBucket).toBe('layer0');
        expect(resolveCallProfile(settings, { kind: 'regenerate' }).policy.healthBucket).toBe(
            'layer0',
        );
    });
});

describe('resolveCallProfile connections', () => {
    it('keeps the settings object as the primary connection for plain calls', () => {
        const settings = makeSummarySettings();
        expect(resolveCallProfile(settings, { kind: 'layer0' }).policy.routes[0].connection).toBe(
            settings,
        );
    });

    it('folds the promotion merge route into the primary connection', () => {
        const settings = makeSummarySettings({
            mergeConnectionSource: 'profile',
            mergeConnectionProfileId: 'deep-merge',
        });
        const primary = resolveCallProfile(settings, { kind: 'promotion' }).policy.routes[0]
            .connection;
        expect(primary).not.toBe(settings);
        expect(primary.connectionSource).toBe('profile');
        expect(primary.connectionProfileId).toBe('deep-merge');

        const layer0 = resolveCallProfile(settings, { kind: 'layer0' }).policy.routes[0].connection;
        expect(layer0).toBe(settings);
    });

    it('resolves a configured distinct fallback route and drops an unconfigured one', () => {
        const configured = makeSummarySettings({
            fallbackConnectionSource: 'profile',
            fallbackConnectionProfileId: 'backup',
        });
        const fallback = resolveCallProfile(configured, { kind: 'layer0' }).policy.routes[1]
            .connection;
        expect(fallback?.connectionSource).toBe('profile');
        expect(fallback?.connectionProfileId).toBe('backup');

        expect(
            resolveCallProfile(makeSummarySettings(), { kind: 'layer0' }).policy.routes,
        ).toHaveLength(1);
        expect(
            resolveCallProfile(makeSummarySettings({ fallbackConnectionSource: 'disabled' }), {
                kind: 'layer0',
            }).policy.routes,
        ).toHaveLength(1);
    });

    it('folds the fallback away when it matches the already-merged promotion route', () => {
        const settings = makeSummarySettings({
            mergeConnectionSource: 'profile',
            mergeConnectionProfileId: 'same-1',
            fallbackConnectionSource: 'profile',
            fallbackConnectionProfileId: 'same-1',
        });
        const promotion = resolveCallProfile(settings, { kind: 'promotion' }).policy.routes;
        expect(promotion[0].connection.connectionProfileId).toBe('same-1');
        expect(promotion).toHaveLength(1);

        const layer0 = resolveCallProfile(settings, { kind: 'layer0' }).policy.routes;
        expect(layer0[1].connection.connectionProfileId).toBe('same-1');
    });
});

describe('resolveCallProfile guard flags', () => {
    it.each([
        ['layer0', true, true],
        ['regenerate', true, true],
        ['promotion', true, false],
    ])(
        'resolves compression and the structural envelope policy for %s',
        (kind, compression, guarded) => {
            const policy = resolveCallProfile(
                makeSummarySettings({ layer0SummaryTokenTarget: 300 }),
                {
                    kind,
                },
            ).policy;
            expect(policy.compression).toBe(compression);
            expect(policy.narrativeEnvelope).toBe(guarded);
        },
    );

    it('leaves compression and the structural envelope unset for uncategorized calls', () => {
        const policy = resolveCallProfile(makeSummarySettings(), {}).policy;
        expect(policy.compression).toBe(false);
        expect(policy.narrativeEnvelope).toBe(false);
    });

    it('freezes the Easy context limit only for Easy mode with a positive finite cap', () => {
        const easy = resolveCallProfile(
            makeSummarySettings({ uiMode: UI_MODES.EASY, advancedModelContext: 4000 }),
            { kind: 'layer0' },
        ).policy;
        expect(easy.easyContextLimit).toBe(4000);

        const advanced = resolveCallProfile(
            makeSummarySettings({ uiMode: UI_MODES.ADVANCED, advancedModelContext: 4000 }),
            { kind: 'layer0' },
        ).policy;
        expect(advanced.easyContextLimit).toBeNull();

        const off = resolveCallProfile(
            makeSummarySettings({ uiMode: UI_MODES.OFF, advancedModelContext: 4000 }),
            { kind: 'layer0' },
        ).policy;
        expect(off.easyContextLimit).toBeNull();
    });

    it('leaves the Easy context limit unset for malformed caps', () => {
        for (const cap of [0, -5, 'abc']) {
            const policy = resolveCallProfile(
                makeSummarySettings({ uiMode: UI_MODES.EASY, advancedModelContext: cap }),
                { kind: 'layer0' },
            ).policy;
            expect(policy.easyContextLimit).toBeNull();
        }
    });

    it('carries the CN ideograph policy verbatim', () => {
        const on = resolveCallProfile(makeSummarySettings({ stripChineseIdeographs: true }), {
            kind: 'layer0',
        }).policy;
        expect(on.stripChineseIdeographs).toBe(true);

        const off = resolveCallProfile(makeSummarySettings(), { kind: 'layer0' }).policy;
        expect(off.stripChineseIdeographs).toBe(false);
    });
});

describe('resolveCallProfile label', () => {
    const settings = makeSummarySettings();

    it('builds one human label per call family', () => {
        expect(
            resolveCallProfile(settings, { kind: 'layer0', sourceRange: [3, 7] }).policy.label,
        ).toBe('L0 turns 3-7');
        expect(
            resolveCallProfile(settings, { kind: 'regenerate', sourceRange: [3, 7] }).policy.label,
        ).toBe('regenerate turns 3-7');
        expect(
            resolveCallProfile(settings, {
                kind: 'promotion',
                layerIndex: 1,
                mergedSnippetCount: 2,
            }).policy.label,
        ).toBe('promotion L1 -> L2 (2 snippets)');
    });

    it('falls back to the raw category and the generic summarizer label', () => {
        expect(resolveCallProfile(settings, { kind: 'ghost-repair' }).policy.label).toBe(
            'ghost-repair',
        );
        expect(resolveCallProfile(settings, {}).policy.label).toBe('summarizer');
    });

    it('degrades missing range and count data without throwing', () => {
        expect(resolveCallProfile(settings, { kind: 'layer0' }).policy.label).toBe('L0 turns ?');
        expect(resolveCallProfile(settings, { kind: 'promotion' }).policy.label).toBe(
            'promotion L? -> L? (? snippets)',
        );
    });
});

describe('resolveCallProfile provenance', () => {
    it('carries the dispatch provenance verbatim', () => {
        const regexStats = { rawTokens: 10, finalTokens: 8 };
        const call = {
            kind: 'layer0',
            sourceRange: [1, 2],
            regexStats,
            sourceTokensBefore: 55,
            sourceTokensBeforeEstimated: true,
        };
        const { provenance } = resolveCallProfile(makeSummarySettings(), call);
        expect(provenance.sourceRange).toBe(call.sourceRange);
        expect(provenance.regexStats).toBe(regexStats);
        expect(provenance.sourceTokensBefore).toBe(55);
        expect(provenance.sourceTokensBeforeEstimated).toBe(true);
    });

    it('keeps promotion overflow payloads verbatim', () => {
        const { provenance } = resolveCallProfile(makeSummarySettings(), {
            kind: 'promotion',
            layerIndex: 2,
            mergedSnippetCount: 4,
            memoryTokensBefore: 900,
            memoryTokensBeforeEstimated: false,
            overflowLayerIndex: 2,
            overflowMemoryCount: 30,
            overflowMemoryLimit: 24,
            overflowTokens: 4000,
            overflowTokenQuota: 3000,
        });
        expect(provenance.layerIndex).toBe(2);
        expect(provenance.mergedSnippetCount).toBe(4);
        expect(provenance.memoryTokensBefore).toBe(900);
        expect(provenance.overflowLayerIndex).toBe(2);
        expect(provenance.overflowMemoryCount).toBe(30);
        expect(provenance.overflowMemoryLimit).toBe(24);
        expect(provenance.overflowTokens).toBe(4000);
        expect(provenance.overflowTokenQuota).toBe(3000);
    });

    it('carries provenance keys and never leaks route or repair flags', () => {
        const { provenance } = resolveCallProfile(makeSummarySettings(), {
            useFallback: true,
            layer0Repair: true,
        });
        expect('useFallback' in provenance).toBe(false);
        expect('layer0Repair' in provenance).toBe(false);
        expect('kind' in provenance).toBe(false);
    });
});
