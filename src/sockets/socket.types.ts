import { Socket } from 'socket.io';

/**
 * Metadata stored for each active socket connection.
 */
export interface SocketConnectionMeta {
  /** Unique socket identifier */
  socketId: string;
  /** Optional authenticated user ID */
  userId?: string;
  /** Timestamp when the connection was established (ms since epoch) */
  connectedAt: number;
  /** Timestamp of the last successful pong received (ms since epoch) */
  lastPongAt: number;
  /** Number of consecutive missed pongs */
  missedPongs: number;
  /** Rooms the socket is currently a member of */
  rooms: string[];
}

/**
 * Payload emitted with the `ping` event.
 */
export interface PingPayload {
  timestamp: number;
}

/**
 * Payload emitted with the `pong` event.
 */
export interface PongPayload {
  timestamp: number;
  latency?: number;
}

/**
 * Payload emitted on `disconnect` events.
 */
export interface DisconnectPayload {
  socketId: string;
  userId?: string;
  reason: string;
  connectedDurationMs: number;
}

/**
 * Events that the server emits to clients.
 */
export interface ServerToClientEvents {
  ping: (payload: PingPayload) => void;
  disconnect_notice: (payload: DisconnectPayload) => void;
}

/**
 * Events that clients emit to the server.
 */
export interface ClientToServerEvents {
  pong: (payload: PongPayload) => void;
  join_room: (room: string) => void;
  leave_room: (room: string) => void;
}

/**
 * Inter-server events (for multi-node setups).
 */
export interface InterServerEvents {
  ping: () => void;
}

/**
 * Per-socket data typed on the Socket instance.
 */
export interface SocketData {
  userId?: string;
  connectedAt: number;
}

/**
 * Typed Socket alias used across the sockets layer.
 */
export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * Result of a health-check sweep.
 */
export interface HealthCheckResult {
  checkedAt: string;
  totalConnections: number;
  staleConnectionsEvicted: number;
  activeConnections: number;
}
