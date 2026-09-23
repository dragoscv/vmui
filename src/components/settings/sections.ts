export const SETTINGS_HUB_SECTIONS = ["general", "security", "users", "access", "automation", "integrations", "data"] as const;
export type SettingsHubSection = (typeof SETTINGS_HUB_SECTIONS)[number];
