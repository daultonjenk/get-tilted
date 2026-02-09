import { useEffect, useMemo, useState } from "react";
import type { TypedMessage } from "@get-tilted/shared-protocol";
import { WSClient, type WSStatus } from "../net/wsClient";

type NetDebugPanelProps = {
  panelOpen: boolean;
};

export function NetDebugPanel({ panelOpen }: NetDebugPanelProps) {
  const client = useMemo(() => new WSClient(), []);
  const [status, setStatus] = useState<WSStatus>(client.getStatus());
  const [roomCode, setRoomCode] = useState("");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [clientsCount, setClientsCount] = useState<number | null>(null);
  const [lastPongT, setLastPongT] = useState<number | null>(null);
  const [lastRttMs, setLastRttMs] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const unsubStatus = client.onStatusChange(setStatus);
    const unsubMessage = client.onMessage((message: TypedMessage) => {
      switch (message.type) {
        case "pong":
          setLastPongT(message.payload.t);
          setLastRttMs(Date.now() - message.payload.t);
          return;
        case "room:created":
          setRoomCode(message.payload.roomCode);
          setJoinRoomCode(message.payload.roomCode);
          return;
        case "room:state":
          setRoomCode(message.payload.roomCode);
          setClientsCount(message.payload.clients);
          return;
        case "error":
          setLastError(`${message.payload.code}: ${message.payload.message}`);
          return;
        default:
          return;
      }
    });
    const unsubError = client.onError((error) => {
      setLastError(error);
    });
    return () => {
      unsubStatus();
      unsubMessage();
      unsubError();
      client.disconnect();
    };
  }, [client]);

  if (!panelOpen) {
    return null;
  }

  return (
    <div className="netDebug">
      <p className="netTitle">Network Debug</p>
      <p>Status: {status}</p>
      <div className="netRow">
        <button type="button" onClick={() => client.connect()}>
          Connect
        </button>
        <button type="button" onClick={() => client.disconnect()}>
          Disconnect
        </button>
      </div>
      <div className="netRow">
        <button
          type="button"
          onClick={() => {
            setLastError(null);
            client.send("ping", { t: Date.now() });
          }}
        >
          Ping
        </button>
        <button
          type="button"
          onClick={() => {
            setLastError(null);
            client.send("room:create", {});
          }}
        >
          Create Room
        </button>
      </div>
      <div className="netRow">
        <input
          value={joinRoomCode}
          onChange={(event) => setJoinRoomCode(event.target.value.toUpperCase())}
          placeholder="ROOMCODE"
        />
        <button
          type="button"
          onClick={() => {
            setLastError(null);
            client.send("room:join", { roomCode: joinRoomCode });
          }}
        >
          Join Room
        </button>
      </div>
      <p>Room: {roomCode || "n/a"}</p>
      <p>Room Clients: {clientsCount ?? "n/a"}</p>
      <p>Last Pong: {lastPongT ?? "n/a"}</p>
      <p>RTT (ms): {lastRttMs ?? "n/a"}</p>
      <p>Error: {lastError ?? "none"}</p>
    </div>
  );
}
