import { describe, expect, it } from "vitest";
import { HYPERV_KINDS, LocalKvmProvider, type LocalKvmCredentials } from "./local-kvm";

// These tests exercise the pure, kind-derived behaviour only: no wsl.exe, no
// PowerShell, no network. The point is to prove that adding a Hyper-V kind
// means adding it to HYPERV_KINDS and nothing else -- every dispatch branch
// must follow from that one list.

function creds(kind: LocalKvmCredentials["kind"], extra: Partial<LocalKvmCredentials> = {}): LocalKvmCredentials {
  return {
    kind,
    distro: "-",
    vmDir: "",
    hostLabel: kind,
    vncPort: 0,
    qmpPort: 0,
    sshPort: 0,
    wsPort: 0,
    ramMb: 4096,
    cores: 2,
    threads: 2,
    ...extra,
  };
}

describe("LocalKvmProvider Hyper-V kinds", () => {
  it("treats both hyperv-win and hyperv-haos as Hyper-V", () => {
    expect(HYPERV_KINDS).toContain("hyperv-win");
    expect(HYPERV_KINDS).toContain("hyperv-haos");
    expect(new LocalKvmProvider(creds("hyperv-win")).isHyperV).toBe(true);
    expect(new LocalKvmProvider(creds("hyperv-haos")).isHyperV).toBe(true);
  });

  it("does not treat QEMU kinds as Hyper-V", () => {
    for (const k of ["mac", "win", "ubuntu"] as const) {
      expect(new LocalKvmProvider(creds(k)).isHyperV).toBe(false);
    }
  });

  it("defaults the Hyper-V VM name per kind", () => {
    // The appliance is built by scripts/homeassistant.ps1 under this name;
    // a wrong default here would make every Start-VM call target a VM that
    // does not exist.
    expect(new LocalKvmProvider(creds("hyperv-haos")).hypervVmName).toBe("homeassistant");
    expect(new LocalKvmProvider(creds("hyperv-win")).hypervVmName).toBe("vmui-win");
  });

  it("lets an explicit hypervVmName override the default", () => {
    const p = new LocalKvmProvider(creds("hyperv-haos", { hypervVmName: "ha-test" }));
    expect(p.hypervVmName).toBe("ha-test");
  });

  it("publishes a template for the appliance", async () => {
    const templates = await new LocalKvmProvider(creds("hyperv-haos")).listInstanceTemplates();
    const t = templates[0];
    expect(templates).toHaveLength(1);
    if (!t) throw new Error("no template");
    expect(t.id).toBe("local-home-assistant-hyperv");
    expect(t.platform).toBe("linux");
    // The single most common reason HAOS fails to boot on Hyper-V. If it
    // ever drops out of the notes, someone will re-learn it the hard way.
    expect((t.notes ?? []).join(" ")).toMatch(/Secure Boot MUST stay off/);
  });
});
