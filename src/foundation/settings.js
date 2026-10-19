import {
    MEMORY_MODE_PRESETS,
    MODULE_NAME,
    PROMPT_SETTING_KEYS,
    defaultSettings,
} from './constants.js';
import { getExtensionSettings, saveSettingsDebounced } from './context.js';
import { isPlainObject } from './objects.js';
import { getAllRouteSettingKeys } from './connection-routes.js';
import { normalizeSettings } from './settings-normalizer.js';
import { readOperationMode, repairOperationMode } from './operation-mode.js';

/**
 * Extension settings as the SillyTavern context holds them: the load-time
 * backfill and repair, the Effective Settings projection, and the defaults
 * reset. The repair itself is host-free.
 */

/**
 * @returns {ExtensionSettings}
 */
export function getSettings() {
    const extensionSettings = getExtensionSettings();
    if (!isPlainObject(extensionSettings[MODULE_NAME])) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const settings = extensionSettings[MODULE_NAME];
    const settingsRecord = /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (settings)
    );
    const defaultsRecord = /** @type {Record<string, unknown>} */ (defaultSettings);
    // Capture before the backfill: the repair passes need to know which keys
    // the stored object carried, not which it has now.
    const hadUiMode = Object.hasOwn(settings, 'uiMode');
    const hadMaskUserRoleMode = Object.hasOwn(settings, 'maskUserRoleMode');
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settingsRecord[key] = defaultsRecord[key];
        }
    }
    const modeSettingsNormalized = repairOperationMode(settings, { hadUiMode });
    const settingsNormalized = normalizeSettings(settings, { hadMaskUserRoleMode });
    if (modeSettingsNormalized || settingsNormalized) {
        saveSettingsDebounced();
    }
    return settings;
}

/**
 * Runtime code should use this when behavior must follow the visible mode.
 * @returns {ExtensionSettings}
 */
export function getEffectiveSettings() {
    const settings = getSettings();
    return readOperationMode(settings).enabled ? settings : { ...settings, enabled: false };
}

/**
 * Debounces so rapid control changes coalesce into one host save.
 * @returns {void}
 */
export function saveSettings() {
    saveSettingsDebounced();
}

/**
 * Keys a defaults reset never touches: the selected memory/UI/config modes and
 * the Operation Mode gate they project, every Connection Route setting (all
 * four keys of every route, derived from the route catalogue), and debugMode
 * (re-enabled explicitly after the reset loop).
 * @type {Set<string>}
 */
const RESET_PRESERVED_KEYS = new Set([
    'memoryMode',
    'uiMode',
    'configMode',
    'enabled',
    ...getAllRouteSettingKeys(),
    'debugMode',
]);

/**
 * Prompt text remains the user's saved draft regardless of the active preset.
 * @param {ExtensionSettings} settings - Settings object mutated in place.
 * @returns {void}
 */
function resetPromptValues(settings) {
    const defaultsRecord = /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (defaultSettings)
    );
    const settingsRecord = /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (settings)
    );
    for (const { presetKey } of PROMPT_SETTING_KEYS) {
        const hasCustomSelection = settingsRecord[presetKey] === 'custom';
        const defaultPreset = defaultsRecord[presetKey];
        if (!hasCustomSelection) {
            settingsRecord[presetKey] = defaultPreset;
        }
    }
}

/**
 * Restores every default except RESET_PRESERVED_KEYS and the prompt profile
 * pairs, which resetPromptValues handles.
 * @returns {void}
 */
export function resetSettingsToDefaults() {
    const s = getSettings();
    const promptKeys = new Set(
        PROMPT_SETTING_KEYS.flatMap(({ presetKey, settingKey }) => [presetKey, settingKey]),
    );
    for (const key of Object.keys(defaultSettings)) {
        if (RESET_PRESERVED_KEYS.has(key) || promptKeys.has(key)) {
            continue;
        }
        const value = defaultSettings[key];
        s[key] = Array.isArray(value) ? [...value] : value;
    }

    resetPromptValues(s);

    // Retention budgets follow the preserved memory mode's preset, not the plain defaults.
    const retentionPreset = MEMORY_MODE_PRESETS[s.memoryMode] || MEMORY_MODE_PRESETS.balanced;
    s.verbatimTokenBudget = retentionPreset.verbatimTokenBudget;
    s.queuedTokenBudget = retentionPreset.queuedTokenBudget;

    // Debug output deliberately re-enables on reset so F12 diagnostics stay available.
    s.debugMode = true;
}
