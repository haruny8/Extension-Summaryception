import { describe, expect, it } from 'vitest';

import { buildLayer0BudgetHint, getSourceTokenCount } from '../src/core/token-budget.js';

describe('buildLayer0BudgetHint', () => {
    it('wraps the advisory source guidance', () => {
        const result = buildLayer0BudgetHint({ targetTokens: 250 });
        expect(result).toContain('<summaryception_source_budget>');
        expect(result).toContain('</summaryception_source_budget>');
        expect(result).toContain('roughly 250 tokens');
        expect(result).not.toContain('[STATE]');
    });

    it('keeps the advisory hint tied to the configured target', () => {
        const result = buildLayer0BudgetHint({ targetTokens: 2000 });
        expect(result).toContain('roughly 2000 tokens');
    });
});

describe('getSourceTokenCount', () => {
    it('prefers sourceTokensBefore', () => {
        expect(
            getSourceTokenCount({
                sourceTokensBefore: 100,
                regexStats: { finalTokens: 50 },
                memoryTokensBefore: 30,
            }),
        ).toBe(100);
    });

    it('falls to regexStats.finalTokens when sourceTokensBefore is absent', () => {
        expect(
            getSourceTokenCount({ regexStats: { finalTokens: 50 }, memoryTokensBefore: 30 }),
        ).toBe(50);
    });

    it('skips a zero sourceTokensBefore and uses regexStats.finalTokens', () => {
        expect(
            getSourceTokenCount({ sourceTokensBefore: 0, regexStats: { finalTokens: 50 } }),
        ).toBe(50);
    });

    it('falls to memoryTokensBefore last', () => {
        expect(getSourceTokenCount({ memoryTokensBefore: 30 })).toBe(30);
    });

    it.each([
        ['empty object', {}],
        ['no argument', undefined],
        ['negative', { sourceTokensBefore: -5 }],
        ['non-numeric', { sourceTokensBefore: 'abc' }],
    ])('returns 0 when no candidate is a positive number (%s)', (_label, metadata) => {
        expect(getSourceTokenCount(metadata)).toBe(0);
    });
});
