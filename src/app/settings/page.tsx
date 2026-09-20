import { SettingsHub } from "@/components/settings/settings-hub";
import { authEnabled } from "@/lib/auth";
import { getQuietHours } from "@/lib/quiet-hours";
import { listBootScriptsAction } from "@/server/actions/boot-scripts";
import { listKnownHostsAction } from "@/server/actions/known-hosts";
import { listWebhooksAction } from "@/server/actions/webhooks";
import { getSettings } from "@/server/queries/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [snapshot, knownHosts, webhooks, bootScripts, quietHours, auth] = await Promise.all([
    getSettings(),
    listKnownHostsAction(),
    listWebhooksAction(),
    listBootScriptsAction(),
    getQuietHours(),
    authEnabled(),
  ]);
  return (
    <SettingsHub
      snapshot={snapshot}
      knownHosts={knownHosts}
      webhooks={webhooks}
      bootScripts={bootScripts}
      quietHours={quietHours}
      authEnabled={auth}
    />
  );
}
