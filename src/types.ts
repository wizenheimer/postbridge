/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * POSTBRIDGE TYPE DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file contains all TypeScript type definitions for the PostBridge library.
 *
 * WHAT IS RPC (Remote Procedure Call)?
 * ────────────────────────────────────
 * RPC is a pattern that allows code running in one context (e.g., a web page) to
 * call functions that exist in another context (e.g., a Web Worker, iframe, or
 * Node.js Worker thread) as if they were local functions.
 *
 * WHY USE RPC?
 * ────────────
 * JavaScript environments are often isolated for security and performance:
 * - Web Workers run in separate threads (can't access DOM but can do heavy computation)
 * - iframes have separate execution contexts (sandboxed for security)
 * - Node.js Worker threads isolate CPU-intensive tasks
 *
 * These contexts can only communicate via message passing (postMessage), which is
 * low-level and cumbersome. RPC abstracts this away, making it feel like you're
 * just calling a regular function.
 *
 * HOW POSTBRIDGE WORKS (High-Level Overview):
 * ────────────────────────────────────────────
 * 1. HANDSHAKE: Two contexts establish a connection and exchange their API schemas
 * 2. PROXY CREATION: Each side creates proxy functions for the other side's methods
 * 3. RPC CALLS: When you call a proxy function, it:
 *    - Serializes the arguments
 *    - Sends a message to the other context
 *    - Waits for a response
 *    - Deserializes and returns the result
 * 4. BIDIRECTIONAL: Both sides can call functions on the other side
 *
 * TERMINOLOGY:
 * ───────────
 * - HOST: The context that initiates the connection (usually the main thread/page)
 * - GUEST: The context being connected to (worker, iframe, child process)
 * - SCHEMA: An object containing functions and data structures to expose via RPC
 * - CONNECTION: A bidirectional communication channel between host and guest
 * - HANDSHAKE: The initial negotiation where both sides exchange their schemas
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * NodeWorker Interface
 * ────────────────────
 * Represents a Node.js Worker thread interface. This is necessary because Node.js
 * workers have a different API than Web Workers (they use 'on'/'off' instead of
 * 'addEventListener'/'removeEventListener').
 *
 * Why we need this:
 * - Web Workers and Node.js Workers have different APIs for the same functionality
 * - This interface provides a unified type that our library can work with
 * - Allows PostBridge to work seamlessly in both browser and Node.js environments
 */
export interface NodeWorker {
  /** Subscribe to events (Node.js style) */
  on(event: string, handler: any): void;
  /** Unsubscribe from events (Node.js style) */
  off(event: string, handler: any): void;
  /** Send a message to the worker */
  postMessage(message: any): void;
  /** Terminate the worker thread */
  terminate(): void;
}

/**
 * WorkerLike Type
 * ───────────────
 * A union type representing anything that behaves like a worker (can send/receive
 * messages). Note that SharedWorker is NOT WorkerLike because it requires messaging
 * through a port (SharedWorker.port.postMessage), not directly on the worker itself.
 *
 * Why this matters:
 * - Different worker types have slightly different APIs
 * - We need to handle both Web Workers and Node.js Workers uniformly
 * - SharedWorker needs special handling (via MessagePort), so it's excluded
 */
export type WorkerLike = Worker | NodeWorker;

/**
 * Event Types
 * ───────────
 * All message-based communication uses the "message" event. This is the standard
 * event name across Web Workers, iframes, and Node.js Workers.
 */
export enum events {
  MESSAGE = "message",
}

/**
 * Action Types
 * ────────────
 * These are the message types that flow between the host and guest during RPC
 * communication. Each message sent via postMessage has an 'action' field that
 * determines how it should be handled.
 *
 * THE RPC LIFECYCLE:
 * 1. HANDSHAKE_REQUEST: Guest → Host (or Host → Guest)
 *    "Hi, I want to connect. Here are the methods I expose."
 *
 * 2. HANDSHAKE_REPLY: Host → Guest (or Guest → Host)
 *    "Connection established. Here are my methods."
 *
 * 3. RPC_REQUEST: Either side
 *    "Please execute this function with these arguments."
 *
 * 4. RPC_RESOLVE or RPC_REJECT: Either side
 *    "Here's the result" or "An error occurred"
 *
 * The "POSTBRIDGE/" prefix is a namespace to avoid collision with user messages.
 */
export enum actions {
  /** Initiates a connection handshake */
  HANDSHAKE_REQUEST = "POSTBRIDGE/HANDSHAKE_REQUEST",
  /** Confirms a connection handshake */
  HANDSHAKE_REPLY = "POSTBRIDGE/HANDSHAKE_REPLY",
  /** Requests execution of a remote function */
  RPC_REQUEST = "POSTBRIDGE/RPC_REQUEST",
  /** Returns successful result of an RPC call */
  RPC_RESOLVE = "POSTBRIDGE/RPC_RESOLVE",
  /** Returns error result of an RPC call */
  RPC_REJECT = "POSTBRIDGE/RPC_REJECT",
}

/**
 * Schema Type
 * ───────────
 * A schema is an object that defines the API surface exposed via RPC. It can
 * contain:
 * - Functions: These become callable remotely
 * - Nested objects: These create namespaced APIs (e.g., schema.math.add)
 * - Data: Can be passed during handshake for initial state
 *
 * Example:
 * const schema = {
 *   add: (a, b) => a + b,
 *   math: {
 *     multiply: (a, b) => a * b
 *   }
 * };
 *
 * After connection, the remote can call:
 * - remote.add(1, 2) → executes on the other side, returns 3
 * - remote.math.multiply(3, 4) → executes on the other side, returns 12
 */
export type Schema = Record<string, any>;

/**
 * Connection Interface
 * ────────────────────
 * Represents an established RPC connection between two contexts. This is what
 * you get back when a connection is successfully established.
 *
 * Properties:
 * - id: Unique identifier for this connection (used to route messages correctly)
 * - remote: A proxy object containing callable functions from the other side
 * - close: Function to tear down the connection and clean up listeners
 *
 * Why we need connection IDs:
 * - A host might connect to multiple guests (multiple workers, multiple iframes)
 * - Connection IDs ensure messages are routed to the correct guest
 * - Prevents message collision when multiple connections exist
 */
export interface Connection {
  /** Unique identifier for this connection */
  id: string;
  /** Proxy object containing callable remote functions */
  remote: Schema;
  /** Closes the connection and removes all event listeners */
  close: () => void;
}

/**
 * Connections Type
 * ────────────────
 * A map of connection IDs to Connection objects. The host maintains this to
 * track all active connections with guests.
 *
 * Example:
 * {
 *   "abc123": { id: "abc123", remote: {...}, close: () => {...} },
 *   "def456": { id: "def456", remote: {...}, close: () => {...} }
 * }
 */
export type Connections = Record<string, Connection>;

/**
 * PostBridgeEvent Interface
 * ─────────────────────────
 * Extends the standard EventListener to add RPC-specific properties. When a
 * message arrives via postMessage, it's wrapped in an event object with these
 * properties.
 *
 * Why we need this:
 * - source: Identifies which window/iframe sent the message (for security checks)
 * - origin: The origin URL of the sender (for cross-origin security validation)
 * - data: The actual payload (one of our action types)
 */
export interface PostBridgeEvent extends EventListener {
  /** The window/iframe that sent the message (iframe communication only) */
  source?: Window;
  /** The origin URL of the sender (for security validation) */
  origin?: string;
  /** The message payload (varies based on action type) */
  data: HandshakeRequestPayload | HandshakeConfirmationPayload | RPCRequestPayload | RPCResolvePayload;
}

/**
 * HandshakeRequestPayload
 * ───────────────────────
 * Sent when one side wants to initiate a connection. This is the first message
 * in the RPC lifecycle.
 *
 * Flow:
 * 1. Guest calls guest.connect(schema)
 * 2. Guest sends HANDSHAKE_REQUEST with its schema to Host
 * 3. Host receives this, processes it, and prepares to reply
 *
 * Fields:
 * - action: Identifies this as a handshake request
 * - connectionID: Unique ID for this connection (generated by host, echoed back)
 * - methodNames: Array of function names in the schema (e.g., ["add", "math.multiply"])
 * - schema: The full schema object (functions removed, data preserved)
 *
 * Why send methodNames separately?
 * - Functions can't be serialized via postMessage
 * - We extract function names and send them as strings
 * - The receiver uses these names to create proxy functions
 */
export interface HandshakeRequestPayload {
  action: actions.HANDSHAKE_REQUEST;
  /** Unique identifier for this connection */
  connectionID: string;
  /** Array of method names available in the schema */
  methodNames: string[];
  /** The schema with functions removed (only data/structure) */
  schema: Schema;
}

/**
 * HandshakeConfirmationPayload
 * ────────────────────────────
 * Sent in response to a HANDSHAKE_REQUEST. Both sides send this to confirm the
 * connection and exchange their schemas.
 *
 * Flow:
 * 1. Host receives HANDSHAKE_REQUEST
 * 2. Host sends HANDSHAKE_REPLY with its own schema
 * 3. Guest receives this and finalizes the connection
 * 4. Guest sends another HANDSHAKE_REPLY to confirm
 *
 * This two-way handshake ensures both sides are ready before RPC calls begin.
 */
export interface HandshakeConfirmationPayload {
  action: actions.HANDSHAKE_REPLY;
  /** The connection ID (must match the request) */
  connectionID: string;
  /** Method names available in this side's schema */
  methodNames: string[];
  /** The schema with functions removed */
  schema: Schema;
}

/**
 * RPCRequestPayload
 * ─────────────────
 * Sent when one side wants to call a function on the other side. This is the
 * core of the RPC mechanism.
 *
 * Example flow:
 * 1. Code calls: remote.add(5, 3)
 * 2. This creates an RPC_REQUEST: { callName: "add", args: [5, 3] }
 * 3. Message is sent via postMessage
 * 4. Other side receives it, executes the real add() function
 * 5. Other side sends back RPC_RESOLVE with the result
 *
 * Fields:
 * - action: Identifies this as an RPC request
 * - args: The arguments to pass to the function
 * - callID: Unique ID for this specific call (to match request with response)
 * - callName: The function to call (e.g., "add" or "math.multiply")
 * - connectionID: Which connection this call belongs to
 *
 * Why do we need callID?
 * - Multiple RPC calls can be in-flight simultaneously
 * - Responses might arrive out of order (async operations)
 * - callID ensures we resolve the correct Promise
 */
export interface RPCRequestPayload {
  action: actions.RPC_REQUEST;
  /** Arguments to pass to the remote function */
  args: any[];
  /** Unique identifier for this specific RPC call */
  callID: string;
  /** Name of the function to call (e.g., "add" or "math.multiply") */
  callName: string;
  /** Which connection this call belongs to */
  connectionID: string;
}

/**
 * RPCResolvePayload
 * ─────────────────
 * Sent in response to an RPC_REQUEST, containing either the result (success)
 * or an error (failure).
 *
 * Flow:
 * 1. Remote executes the function
 * 2. If successful: sends RPC_RESOLVE with result
 * 3. If error: sends RPC_REJECT with error details
 * 4. Original caller's Promise is resolved or rejected accordingly
 *
 * Fields:
 * - action: RPC_RESOLVE (success) or RPC_REJECT (error)
 * - result: The return value of the function (if successful)
 * - error: The error object (if failed)
 * - callID: Matches the callID from the request
 * - callName: The function that was called
 * - connectionID: Which connection this response belongs to
 *
 * Why serialize errors?
 * - Error objects can't be cloned by postMessage
 * - We serialize them using JSON.stringify with Object.getOwnPropertyNames
 * - This preserves the error message, stack trace, and custom properties
 */
export interface RPCResolvePayload {
  /** RPC_RESOLVE for success, RPC_REJECT for errors */
  action: actions.RPC_RESOLVE | actions.RPC_REJECT;
  /** The return value (only present if action is RPC_RESOLVE) */
  result?: any | null;
  /** The error object (only present if action is RPC_REJECT) */
  error?: Error | null;
  /** Matches the callID from the request */
  callID: string;
  /** The function that was called */
  callName: string;
  /** Which connection this response belongs to */
  connectionID: string;
}

/**
 * GuestConnectOptions
 * ───────────────────
 * Configuration options when a guest initiates a connection to a host.
 *
 * Options:
 * - hostTarget: Manually specify the host to connect to (usually auto-detected)
 * - onConnectionSetup: Async callback fired after connection but before resolving
 *
 * Why hostTarget?
 * - Usually auto-detected (parent window for iframe, self for worker)
 * - But you might want to connect to a specific target in complex scenarios
 *
 * Why onConnectionSetup?
 * - Allows you to perform initialization with the remote API
 * - The connection won't fully resolve until this callback completes
 * - Useful for handshaking custom state or verifying capabilities
 */
export type GuestConnectOptions = {
  /** Override the auto-detected host target */
  hostTarget?: Target;
  /** Callback executed after connection is established but before promise resolves */
  onConnectionSetup?: (remote: Schema) => Promise<void>;
};

/**
 * Guest Type
 * ──────────
 * Represents any context that can act as a guest in an RPC connection. The host
 * connects TO a guest.
 *
 * Types:
 * - WorkerLike (Worker, NodeWorker): For Web Workers or Node.js Worker threads
 * - HTMLIFrameElement: For iframe-based sandboxing
 * - SharedWorker: For shared worker contexts (messaged via port)
 */
export type Guest = WorkerLike | HTMLIFrameElement | SharedWorker;

/**
 * Target Type
 * ───────────
 * Represents anything that can receive messages via postMessage. This is used
 * for sending messages.
 *
 * Types:
 * - Window: For iframe communication
 * - WorkerLike: For worker communication
 * - MessagePort: For SharedWorker communication
 */
export type Target = Window | WorkerLike | MessagePort;

/**
 * Environment Type
 * ────────────────
 * Represents the current execution environment where code is running. This is
 * used for listening to messages.
 *
 * Why distinguish Environment from Target?
 * - Target: Where we SEND messages (postMessage destination)
 * - Environment: Where we LISTEN for messages (addEventListener source)
 * - Sometimes these are different (e.g., SharedWorker uses port for both)
 */
export type Environment = Window | WorkerLike | MessagePort;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SOCKBRIDGE TYPE DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bridge is PostBridge's cross-tab broadcasting feature using SharedWorkers.
 * It provides pub/sub RPC where one tab's function call automatically
 * broadcasts to all other connected tabs.
 *
 * HOW BRIDGE WORKS:
 * ─────────────────
 * - 1:N broadcasting across tabs (instead of 1:1 communication)
 * - SharedWorker as dumb relay (no business logic)
 * - Event listeners for observing broadcasts from other tabs
 * - No echo: sender doesn't receive own broadcasts
 * - Single schema definition in tabs (worker infers methods)
 *
 * ARCHITECTURE:
 * ────────────
 * Tab A → calls remote.method(args)
 *   ↓ Executes locally, gets result
 *   ↓ Sends broadcast message to SharedWorker
 * SharedWorker → relays to Tab B, Tab C, Tab D (excludes Tab A)
 *   ↓
 * Tab B, C, D → execute same method(args), fire listeners
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * SocketBridge Action Types
 * ─────────────────────────
 * Message types for cross-tab broadcasting via SharedWorker.
 *
 * Flow:
 * 1. BRIDGE_HANDSHAKE: Tab → Worker
 *    "Hi, I'm Tab X. Here are my available methods."
 *
 * 2. BRIDGE_HANDSHAKE_ACK: Worker → Tab
 *    "Connected as Tab X. You can now broadcast."
 *
 * 3. BRIDGE_BROADCAST: Tab → Worker
 *    "Execute method(args) on all other tabs."
 *
 * 4. BRIDGE_RELAY: Worker → Tabs
 *    "Tab X called method(args). Execute it locally."
 */
export enum bridgeActions {
  /** Tab registers with worker */
  BRIDGE_HANDSHAKE = "SOCKBRIDGE/HANDSHAKE",
  /** Worker confirms tab registration */
  BRIDGE_HANDSHAKE_ACK = "SOCKBRIDGE/HANDSHAKE_ACK",
  /** Tab broadcasts a function call */
  BRIDGE_BROADCAST = "SOCKBRIDGE/BROADCAST",
  /** Worker relays broadcast to other tabs */
  BRIDGE_RELAY = "SOCKBRIDGE/RELAY",
  /** Tab disconnects from worker */
  BRIDGE_DISCONNECT = "SOCKBRIDGE/DISCONNECT",
  /** Tab requests current shared state */
  BRIDGE_GET_STATE = "SOCKBRIDGE/GET_STATE",
  /** Worker responds with shared state */
  BRIDGE_STATE_RESPONSE = "SOCKBRIDGE/STATE_RESPONSE",
  /** Tab updates shared state */
  BRIDGE_SET_STATE = "SOCKBRIDGE/SET_STATE",
  /** Worker broadcasts state update to all tabs */
  BRIDGE_STATE_UPDATE = "SOCKBRIDGE/STATE_UPDATE",
  /** Worker sends error during handshake */
  BRIDGE_HANDSHAKE_ERROR = "SOCKBRIDGE/HANDSHAKE_ERROR",
  /** Tab requests list of connected tabs */
  BRIDGE_GET_TABS = "SOCKBRIDGE/GET_TABS",
  /** Worker responds with list of connected tabs */
  BRIDGE_TABS_RESPONSE = "SOCKBRIDGE/TABS_RESPONSE",
  /** Tab sends direct message to specific tab */
  BRIDGE_DIRECT_MESSAGE = "SOCKBRIDGE/DIRECT_MESSAGE",
}

/**
 * SocketBridge Handshake Payload
 * ──────────────────────────────
 * Sent by tab when connecting to SharedWorker.
 * Tells worker which methods this tab supports and initial state.
 */
export interface BridgeHandshakePayload {
  action: bridgeActions.BRIDGE_HANDSHAKE;
  /** Unique tab identifier */
  tabID: string;
  /** Array of method names available in this tab's schema */
  methodNames: string[];
  /** Non-function properties from schema (shared state) */
  schema?: Schema;
  /** Channel name for state isolation (default: "default") */
  channel?: string;
}

/**
 * SocketBridge Handshake Acknowledgment
 * ─────────────────────────────────────
 * Sent by worker to confirm tab connection and provide shared state.
 */
export interface BridgeHandshakeAckPayload {
  action: bridgeActions.BRIDGE_HANDSHAKE_ACK;
  /** The tab's unique identifier */
  tabID: string;
  /** Channel name (echoed back for confirmation) */
  channel: string;
  /** Current shared state from worker for this channel */
  sharedState?: Schema;
}

/**
 * SocketBridge Handshake Error Payload
 * ────────────────────────────────────
 * Sent by worker when handshake fails (e.g., duplicate tabID).
 */
export interface BridgeHandshakeErrorPayload {
  action: bridgeActions.BRIDGE_HANDSHAKE_ERROR;
  /** Error message describing the issue */
  error: string;
  /** Error code for programmatic handling */
  code: "DUPLICATE_TAB_ID" | "INVALID_PAYLOAD" | "UNKNOWN_ERROR";
  /** Original tabID that caused the error */
  tabID?: string;
  /** Channel that was attempted */
  channel?: string;
}

/**
 * SocketBridge Broadcast Payload
 * ──────────────────────────────
 * Sent by tab to request broadcasting a function call to all other tabs.
 *
 * Flow:
 * 1. Tab calls remote.updateCount(5)
 * 2. Tab executes updateCount(5) locally, gets result
 * 3. Tab sends BRIDGE_BROADCAST to worker
 * 4. Worker relays to all other tabs (excludes sender)
 */
export interface BridgeBroadcastPayload {
  action: bridgeActions.BRIDGE_BROADCAST;
  /** ID of tab sending the broadcast */
  senderTabID: string;
  /** Channel to broadcast on */
  channel: string;
  /** Name of method to execute */
  methodName: string;
  /** Arguments to pass to method */
  args: any[];
  /** Result from sender's local execution (for listeners) */
  result?: any;
  /** Error if sender's execution failed */
  error?: any;
}

/**
 * SocketBridge Relay Payload
 * ──────────────────────────
 * Sent by worker to relay a broadcast from one tab to others.
 *
 * Receiving tabs:
 * 1. Execute methodName(args) locally
 * 2. Fire registered listeners with result
 */
export interface BridgeRelayPayload {
  action: bridgeActions.BRIDGE_RELAY;
  /** ID of tab that originated the broadcast */
  senderTabID: string;
  /** Name of method to execute */
  methodName: string;
  /** Arguments to pass to method */
  args: any[];
  /** Result from sender's execution (for optimization) */
  senderResult?: any;
  /** Error from sender (if failed) */
  senderError?: any;
}

/**
 * SocketBridge Direct Message Payload
 * ───────────────────────────────────
 * Sent to worker to relay a message to a specific tab only.
 */
export interface BridgeDirectMessagePayload {
  action: bridgeActions.BRIDGE_DIRECT_MESSAGE;
  /** ID of tab sending the message */
  senderTabID: string;
  /** ID of the target tab to receive the message */
  targetTabID: string;
  /** Channel both tabs are on */
  channel: string;
  /** Name of method to execute */
  methodName: string;
  /** Arguments to pass to method */
  args: any[];
  /** Result from sender's execution (for consistency) */
  result?: any;
  /** Error if sender's execution failed */
  error?: any;
}

/**
 * SocketBridge Disconnect Payload
 * ───────────────────────────────
 * Sent by tab when closing connection.
 */
export interface BridgeDisconnectPayload {
  action: bridgeActions.BRIDGE_DISCONNECT;
  /** ID of tab disconnecting */
  tabID: string;
  /** Channel the tab was connected to */
  channel: string;
}

/**
 * SocketBridge Get Tabs Payload
 * ─────────────────────────────
 * Sent by tab to request list of all connected tabs on a channel.
 */
export interface BridgeGetTabsPayload {
  action: bridgeActions.BRIDGE_GET_TABS;
  /** Channel to get tabs for */
  channel: string;
  /** Tab making the request (for response routing) */
  requestingTabID: string;
}

/**
 * SocketBridge Tabs Response Payload
 * ──────────────────────────────────
 * Sent by worker with list of connected tabs on a channel.
 */
export interface BridgeTabsResponsePayload {
  action: bridgeActions.BRIDGE_TABS_RESPONSE;
  /** Array of connected tab IDs on this channel */
  tabIDs: string[];
  /** Channel these tabs are connected to */
  channel: string;
}

/**
 * SocketBridge Connection
 * ───────────────────────
 * Represents an active cross-tab broadcast connection.
 *
 * Properties:
 * - id: Unique identifier for this tab
 * - remote: Proxy object with broadcast methods and direct messaging
 * - getConnectedTabs: Get list of all connected tab IDs
 * - close: Disconnect and cleanup
 */
export interface BridgeConnection {
  /** Unique identifier for this tab */
  id: string;
  /**
   * Proxy object containing broadcast methods and direct messaging.
   *
   * Usage:
   * - `conn.remote.method()` - Broadcasts to all tabs (executes schema function in all tabs)
   * - `conn.remote(tabID).method()` - Sends to specific tab only (executes schema function in target tab)
   */
  remote: Schema & ((targetTabID: string) => Schema);
  /**
   * Get list of all connected tab IDs on this channel.
   * @returns Promise that resolves to array of tab IDs (includes this tab)
   */
  getConnectedTabs(): Promise<string[]>;
  /** Close the connection and cleanup */
  close: () => void;
}

/**
 * SocketBridge Connect Options
 * ────────────────────────────
 * Configuration options when connecting to SharedWorker.
 *
 * Options:
 * - workerURL: URL to SharedWorker script (if not using embedded worker)
 * - channel: Channel name for isolated state spaces (default: "default")
 * - tabID: Custom tab identifier (optional, auto-generated if not provided)
 */
export type BridgeConnectOptions = {
  /** URL to SharedWorker script (optional, defaults to embedded worker) */
  workerURL?: string;
  /** Channel name for isolated state spaces (optional, defaults to "default") */
  channel?: string;
  /** Custom tab identifier (optional, auto-generated if not provided) */
  tabID?: string;
};
