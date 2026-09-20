// Minimal local SOCKS5 proxy for the Egypt egress tunnel.
// The reverse SSH tunnel forwards VPS:13390 -> here; this server answers
// with SOCKS5 (no auth, loopback only), so Playwright on the VPS can route
// Facebook traffic through the user's home IP in Egypt.
import net from "node:net";

const PORT = 13390;

const server = net.createServer((client) => {
  client.once("data", (greeting) => {
    // SOCKS5 greeting: expect VER=5, at least one method, NO AUTH (0) offered.
    if (greeting[0] !== 5) return client.destroy();
    client.write(Buffer.from([5, 0])); // choose NO AUTH

    client.once("data", (request) => {
      if (request[0] !== 5 || request.length < 7) return client.destroy();
      const cmd = request[1];
      if (cmd !== 1 && cmd !== 3) {
        // only CONNECT (1) and UDP ASSOCIATE (3) handled; BIND unsupported
        client.write(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
        return client.destroy();
      }
      let host = "";
      let port = 0;
      const atyp = request[3];
      if (atyp === 1) {
        host = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
        port = (request[8] << 8) | request[9];
      } else if (atyp === 3) {
        const len = request[4];
        host = request.slice(5, 5 + len).toString("ascii");
        port = (request[5 + len] << 8) | request[6 + len];
      } else if (atyp === 4) {
        const b = request.slice(4, 20);
        host = Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(":");
        port = (request[20] << 8) | request[21];
      } else {
        client.write(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]));
        return client.destroy();
      }

      const upstream = net.connect(port, host, () => {
        client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); // success
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => {
        client.write(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]));
        client.destroy();
      });
      client.on("error", () => upstream.destroy());
    });
  });
  client.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[socks5-egress] listening on 127.0.0.1:${PORT}`);
});
