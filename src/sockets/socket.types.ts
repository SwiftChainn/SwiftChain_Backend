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

// ─── Offline sync types ───────────────────────────────────────────────────────

/**
 * A single buffered location point captured while the driver was offline.
 */
export interface OfflineLocationPoint {
  /** Client-side timestamp (ms since epoch) at which the fix was taken. */
  capturedAt: number;
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
  /** Optional delivery the driver was working on at capture time. */
  deliveryId?: string;
}

/**
 * Payload sent by a driver on the `location:sync` event upon reconnection.
 */
export interface LocationSyncPayload {
  /**
   * Ordered array of location points buffered offline.
   * The service will deduplicate and process them in chronological order.
   */
  updates: OfflineLocationPoint[];
}

/**
 * Per-item result within a sync acknowledgement.
 */
export interface SyncItemResult {
  capturedAt: number;
  status: 'saved' | 'duplicate' | 'invalid' | 'error';
  /** Populated when status === 'error' or 'invalid'. */
  reason?: string;
}

/**
 * Acknowledgement payload emitted back on `location:sync_ack`.
 */
export interface LocationSyncAck {
  /** ISO timestamp of when the server processed the batch. */
  processedAt: string;
  /** Total number of points received. */
  received: number;
  /** Number of points successfully persisted. */
  saved: number;
  /** Number of duplicate points skipped. */
  duplicates: number;
  /** Number of points that failed validation or persistence. */
  failed: number;
  /** Per-item results for full client-side reconciliation. */
  results: SyncItemResult[];
}

/**
 * Events that the server emits to clients.
 */
export interface ServerToClientEvents {
  ping: (payload: PingPayload) => void;
  disconnect_notice: (payload: DisconnectPayload) => void;
  location_sync_ack: (payload: LocationSyncAck) => void;
}

/**
 * Events that clients emit to the server.
 */
export interface ClientToServerEvents {
  pong: (payload: PongPayload) => void;
  join_room: (room: string) => void;
  leave_room: (room: string) => void;
  /** Fired by driver upon reconnection to flush offline-buffered updates. */
  location_sync: (payload: LocationSyncPayload) => void;
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
