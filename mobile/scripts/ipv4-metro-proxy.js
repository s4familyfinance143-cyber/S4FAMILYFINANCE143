/**
 * Forward IPv4 127.0.0.1:fromPort -> ::1:toPort (no admin needed).
 * Use when Metro binds IPv6-only and adb reverse uses IPv4.
 */
const net = require("net");
const fromPort = Number(process.env.S4_PROXY_FROM || 8082);
const toPort = Number(process.env.S4_PROXY_TO || 8082);
const server = net.createServer((client) => {
  const upstream = net.connect({ host: "::1", port: toPort }, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
});
server.listen(fromPort, "127.0.0.1", () => {
  console.log(`proxy 127.0.0.1:${fromPort} -> [::1]:${toPort}`);
});
