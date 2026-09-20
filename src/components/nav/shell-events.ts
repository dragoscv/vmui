export const PALETTE_EVENT = "vmui:command-palette";
export const SIDEBAR_TOGGLE_EVENT = "vmui:sidebar-toggle";
export const SIDEBAR_COLLAPSED_KEY = "vmui.sidebar.collapsed";
export const RECENT_ROUTES_KEY = "vmui.recent";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

export function toggleSidebarRail() {
  window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT));
}
