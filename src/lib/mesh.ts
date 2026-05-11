import "server-only";
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";

export interface WgPeer {
  name: string;
  ip: string;
  publicIp: string | null;
  /** /32 inside the WG subnet, e.g. "10.66.0.2/32" */
  wgAddress: string;
  /** Port the peer listens on, default 51820 */
  listenPort?: number;
}

export interface WgKeypair {
  privateKey: string;
  publicKey: string;
}

/**
 * Generate an x25519 keypair. WireGuard wants raw 32-byte keys base64-encoded.
 */
export function generateWgKeypair(): WgKeypair {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const priv = privateKey.export({ format: "der", type: "pkcs8" });
  const pub = publicKey.export({ format: "der", type: "spki" });
  // Strip DER prefix to get the raw 32 bytes.
  const rawPriv = priv.subarray(priv.length - 32);
  const rawPub = pub.subarray(pub.length - 32);
  return {
    privateKey: rawPriv.toString("base64"),
    publicKey: rawPub.toString("base64"),
  };
}

/**
 * Suppress unused-import warning when the helpers above are only used in some
 * code paths.
 */
void createPrivateKey;
void createPublicKey;

/**
 * Build a full WireGuard mesh: every peer connects to every other peer. Returns
 * a Record of `{ peerName: wg0.conf body }`.
 */
export function buildMesh(peers: WgPeer[]): { configs: Record<string, string>; keys: Record<string, WgKeypair> } {
  const keys: Record<string, WgKeypair> = {};
  for (const p of peers) keys[p.name] = generateWgKeypair();
  const configs: Record<string, string> = {};
  for (const p of peers) {
    const kp = keys[p.name]!;
    const lines = [
      "[Interface]",
      `Address = ${p.wgAddress}`,
      `PrivateKey = ${kp.privateKey}`,
      `ListenPort = ${p.listenPort ?? 51820}`,
      "",
    ];
    for (const other of peers) {
      if (other.name === p.name) continue;
      const otherKp = keys[other.name]!;
      lines.push("[Peer]");
      lines.push(`# ${other.name}`);
      lines.push(`PublicKey = ${otherKp.publicKey}`);
      lines.push(`AllowedIPs = ${other.wgAddress}`);
      if (other.publicIp) lines.push(`Endpoint = ${other.publicIp}:${other.listenPort ?? 51820}`);
      lines.push("PersistentKeepalive = 25");
      lines.push("");
    }
    configs[p.name] = lines.join("\n");
  }
  return { configs, keys };
}

/**
 * Build a Tailscale `up` command for a single instance, given an auth key. The
 * tag is recommended; `--ssh` enables Tailscale SSH, `--advertise-routes` is
 * optional.
 */
export function tailscaleUpCommand(opts: {
  authKey: string;
  hostname?: string;
  tags?: string[];
  ssh?: boolean;
  advertiseRoutes?: string[];
}): string {
  const parts = ["sudo tailscale up", `--authkey=${opts.authKey}`];
  if (opts.hostname) parts.push(`--hostname=${opts.hostname}`);
  if (opts.tags && opts.tags.length > 0) parts.push(`--advertise-tags=${opts.tags.join(",")}`);
  if (opts.ssh) parts.push("--ssh");
  if (opts.advertiseRoutes && opts.advertiseRoutes.length > 0) {
    parts.push(`--advertise-routes=${opts.advertiseRoutes.join(",")}`);
  }
  return parts.join(" ");
}

export function tailscaleInstallCommand(): string {
  return "curl -fsSL https://tailscale.com/install.sh | sh";
}
