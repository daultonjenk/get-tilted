import http from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

const port = Number(process.env.PORT ?? 3001);

const httpServer = http.createServer((_, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

const wss = new WebSocketServer({
  server: httpServer,
});

wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
  const remote = request.socket.remoteAddress ?? "unknown";
  console.log(`[${new Date().toISOString()}] connection ${remote}`);
  socket.on("close", (code: number, reasonBuffer: Buffer) => {
    const reason = reasonBuffer.toString() || "no-reason";
    console.log(`[${new Date().toISOString()}] disconnect ${remote} (${code}:${reason})`);
  });
});

httpServer.listen(port, () => {
  console.log(`[${new Date().toISOString()}] server ready on port ${port}`);
});
