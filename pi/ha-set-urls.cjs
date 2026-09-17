// Set HA core external_url / internal_url over the websocket (the only supported write path).
// usage: T=<long-lived token> node ha-set-urls.cjs https://home.example.com http://192.168.100.232
const WS = require("ws");
const [external, internal] = process.argv.slice(2);
const ws = new WS(process.env.HA_WS || "ws://127.0.0.1:80/api/websocket");
const timer = setTimeout(() => { console.error("timeout waiting for HA websocket"); process.exit(2); }, 12000);
ws.on("message", (m) => {
  const j = JSON.parse(m);
  if (j.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: process.env.T }));
  else if (j.type === "auth_invalid") { console.error("auth invalid"); process.exit(1); }
  else if (j.type === "auth_ok") ws.send(JSON.stringify({ id: 1, type: "config/core/update", external_url: external, internal_url: internal }));
  else if (j.id === 1) {
    clearTimeout(timer);
    console.log(j.success ? "core config updated" : JSON.stringify(j.error));
    ws.close();
    process.exit(j.success ? 0 : 1);
  }
});
ws.on("close", (c) => { console.error("closed", c); process.exit(3); });
ws.on("error", (e) => { console.error(e.message); process.exit(1); });
