import http from "node:http";
import { WebSocketServer } from "ws";
import { handleWsConnection } from "./ws/wsRouter.js";

const port = Number(process.env.PORT ?? 3001);

const httpServer = http.createServer((_, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

const wss = new WebSocketServer({
  noServer: true,
});

httpServer.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws, request) => {
  handleWsConnection(ws, request);
});

httpServer.listen(port, () => {
  console.log(`[${new Date().toISOString()}] server ready on port ${port}`);
});
