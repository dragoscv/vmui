"use server";

import { LocalKvmProvider } from "@/lib/providers/local-kvm";
import { getProvider } from "@/lib/providers/registry";

export interface ScreenshotResult {
  ok: boolean;
  width?: number;
  height?: number;
  rgbBase64?: string;
  error?: string;
}

/**
 * Returns a small RGB-encoded screenshot of the guest framebuffer for
 * a local-kvm account. The client decodes the base64 to a Uint8Array,
 * expands RGB→RGBA and paints to a <canvas>.
 *
 * Returns ok:true with no data when the VM is off (UI shows placeholder).
 */
export async function getScreenshotAction(
  accountId: string,
  maxWidth = 480,
): Promise<ScreenshotResult> {
  try {
    const { provider } = await getProvider(accountId);
    if (!(provider instanceof LocalKvmProvider)) {
      return { ok: false, error: "Screenshots only available on local-kvm accounts" };
    }
    const shot = await provider.getScreenshot(maxWidth);
    if (!shot) return { ok: true };
    return {
      ok: true,
      width: shot.width,
      height: shot.height,
      rgbBase64: shot.rgbBase64,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
