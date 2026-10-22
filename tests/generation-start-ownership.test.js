import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onGenerationStarted } from '../src/entry/events.js';
import { installSummaryContext, makeForegroundGate } from './test-helpers.js';

describe('generation start request ownership', () => {
    let gate;
    const queue = { isRequestLive: vi.fn() };

    beforeEach(() => {
        gate = makeForegroundGate().gate;
        queue.isRequestLive.mockReset();
        queue.isRequestLive.mockReturnValue(false);
        installSummaryContext({ chat: [] });
    });

    it('observes host generation starts while an automatic request is preparing', () => {
        queue.isRequestLive.mockReturnValue(true);
        gate.setAutomaticRequestWaiting(true);

        onGenerationStarted(['normal', {}, false], { gate, queue });

        expect(gate.isFrozen()).toBe(true);
        expect(gate.getGenerationEpoch()).toBe(1);
    });

    it('ignores generation starts during Summaryception provider transport', () => {
        queue.isRequestLive.mockReturnValue(true);
        gate.setAutomaticRequestWaiting(true);
        gate.setAutomaticProviderActive(true);

        onGenerationStarted(['normal', {}, false], { gate, queue });

        expect(gate.isFrozen()).toBe(false);
        expect(gate.getGenerationEpoch()).toBe(0);
    });

    it('ignores generation starts while a non-automatic Summaryception request is live', () => {
        queue.isRequestLive.mockReturnValue(true);

        onGenerationStarted(['normal', {}, false], { gate, queue });

        expect(gate.isFrozen()).toBe(false);
        expect(gate.getGenerationEpoch()).toBe(0);
    });
});
