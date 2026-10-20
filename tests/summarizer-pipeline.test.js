import { describe, expect, it } from 'vitest';

import { buildSummarizerPipelineInput } from '../src/core/summarizer-pipeline.js';
import { defaultSettings } from '../src/foundation/constants.js';
import { installSummaryContext } from './test-helpers.js';

describe('buildSummarizerPipelineInput', () => {
    it('routes the auditor call category to the auditor prompts with substitution', async () => {
        installSummaryContext();

        const request = await buildSummarizerPipelineInput({
            storyTxt: 'USER TURN',
            contextStr: 'PRIOR STATE',
            metadata: { kind: 'auditor' },
        });

        expect(request.profile.policy.systemPrompt).toBe(defaultSettings.auditorSystemPrompt);
        expect(request.prompt).toContain('PRIOR STATE');
        expect(request.prompt).toContain('USER TURN');
        expect(request.repairPrompt).toBe('');
    });

    it('replaces every message count placeholder in user and repair prompts', async () => {
        installSummaryContext();

        const request = await buildSummarizerPipelineInput({
            storyTxt: 'SOURCE TEXT',
            contextStr: 'PRIOR STATE',
            metadata: { kind: 'layer0', messageCount: 2 },
            settings: {
                ...defaultSettings,
                promptPreset: 'custom',
                summarizerRepairPromptPreset: 'custom',
                summarizerUserPrompt:
                    '{{message_count}} / {{message_count}} / {{context_str}} / {{story_txt}}',
                summarizerRepairPrompt: 'repair {{message_count}} / {{message_count}}',
            },
        });

        expect(request.prompt).toContain('2 / 2 / PRIOR STATE / SOURCE TEXT');
        expect(request.repairPrompt).toContain('repair 2 / 2');
    });

    it('uses the number of merged summaries for promotion prompts', async () => {
        installSummaryContext();

        const request = await buildSummarizerPipelineInput({
            storyTxt: '<narrative>merged summaries</narrative>',
            contextStr: 'PRIOR STATE',
            metadata: { kind: 'promotion', mergedSnippetCount: 3 },
            settings: {
                ...defaultSettings,
                promotionPromptPreset: 'custom',
                promotionUserPrompt: 'Merging {{message_count}} source summaries: {{story_txt}}',
            },
        });

        expect(request.prompt).toContain('Merging 3 source summaries:');
    });

    it('defaults include the count macro and no longer require the player-name macro', () => {
        const templates = [
            defaultSettings.summarizerUserPrompt,
            defaultSettings.summarizerRepairPrompt,
            defaultSettings.promotionUserPrompt,
            defaultSettings.auditorUserPrompt,
        ];

        for (const template of templates) {
            expect(template).toContain('{{message_count}}');
            expect(template).not.toContain('{{player_name}}');
        }
    });
});
