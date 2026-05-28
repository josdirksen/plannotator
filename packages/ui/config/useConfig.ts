/**
 * React hook for consuming ConfigStore values.
 *
 * Uses Zustand selector-based subscriptions — components only re-render
 * when their specific setting changes.
 */

import { useConfigStore, type SettingValue } from './configStore';
import type { SettingName } from './settings';

/** Read a config value reactively. Re-renders only when this key changes. */
export function useConfigValue<K extends SettingName>(key: K): SettingValue<K> {
  return useConfigStore((s) => s[key]) as SettingValue<K>;
}
