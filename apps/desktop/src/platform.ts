import * as React from "react";
import { api } from "./lib";

export type AppInfo = { root: string; vmui: string; haUrl: string; displayUrl: string; version: string; mobile?: boolean };

/** Detected once: Android/iOS webview UA, or the Rust side says so. */
export const isMobileUA = /Android|iPhone|iPad/i.test(navigator.userAgent);

const Ctx = React.createContext<AppInfo | null>(null);
export const PlatformProvider = Ctx.Provider;
export function usePlatform(): AppInfo & { mobile: boolean } {
  const i = React.useContext(Ctx);
  return { root: "", vmui: "", haUrl: "", displayUrl: "", version: "", ...(i ?? {}), mobile: i?.mobile ?? isMobileUA };
}
export function useAppInfo() {
  const [info, setInfo] = React.useState<AppInfo | null>(null);
  const refresh = React.useCallback(() => api.appInfo().then((i) => setInfo(i as AppInfo)).catch(() => setInfo({ root: "", vmui: "", haUrl: "", displayUrl: "", version: "?", mobile: isMobileUA })), []);
  React.useEffect(() => void refresh(), [refresh]);
  return { info, refresh };
}
