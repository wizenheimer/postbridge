/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * POSTBRIDGE HOST (SERVER) IMPLEMENTATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file implements the host-side connection logic. A "host" is the parent
 * context (main thread, parent window) that creates and manages guests (workers,
 * iframes, child processes).
 *
 * HOST vs GUEST:
 * ─────────────
 * - HOST: The parent context that creates and manages guests
 * - GUEST: The child context created by the host
 *
 * Example scenarios:
 * - Main page (host) creates Web Worker (guest)
 * - Parent window (host) embeds iframe (guest)
 * - Node.js main thread (host) spawns Worker thread (guest)
 *
 * HOST RESPONSIBILITIES:
 * ─────────────────────
 * 1. Create/spawn the guest (worker, iframe)
 * 2. Wait for HANDSHAKE_REQUEST from guest
 * 3. Validate guest identity (for security, especially iframes)
 * 4. Generate unique connectionID
 * 5. Send HANDSHAKE_REPLY with connectionID and host methods
 * 6. Wait for confirmation HANDSHAKE_REPLY
 * 7. Track connection for cleanup
 * 8. Return Connection object for making RPC calls
 *
 * THE HANDSHAKE FLOW (Host Perspective):
 * ──────────────────────────────────────
 * 1. Host calls host.connect(guest, schema)
 * 2. Host waits for HANDSHAKE_REQUEST ← Guest
 * 3. Host validates guest (security check for iframes)
 * 4. Host generates connectionID
 * 5. Host registers RPC handlers for both directions
 * 6. Host sends HANDSHAKE_REPLY → Guest
 *    - Includes connectionID, host methods, schema
 * 7. Host waits for confirmation HANDSHAKE_REPLY ← Guest
 * 8. Connection established! Both sides can now make RPC calls
 *
 * MULTI-CONNECTION SUPPORT:
 * ────────────────────────
 * The host can manage multiple connections simultaneously:
 * - Each connection gets a unique connectionID
 * - Connections are tracked in a global connections map
 * - Messages are routed by connectionID
 * - Each connection can be closed independently
 *
 * SECURITY:
 * ────────
 * For iframes, the host validates messages:
 * - Checks event.origin matches iframe.src origin
 * - Checks event.source matches iframe.contentWindow
 * - Prevents malicious iframes from impersonating trusted ones
 * - Workers don't need origin validation (already isolated by browser)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  addEventListener,
  extractMethods,
  generateId,
  getEventData,
  getOriginFromURL,
  isNodeEnv,
  isNodeWorker,
  isWorkerLike,
  postMessageToTarget,
  removeEventListener,
} from "./helpers";
import { registerLocalMethods, registerRemoteMethods } from "./rpc";
import { actions, events, Guest, Connection, Connections, Schema } from "./types";

/**
 * Global Connections Map
 * ──────────────────────
 * Stores all active connections managed by this host. Each connection is
 * indexed by its unique connectionID.
 *
 * Why global?
 * - Allows host to manage multiple guests simultaneously
 * - Enables cleanup of all connections if needed
 * - Prevents duplicate connections with same ID
 *
 * Structure:
 * {
 *   "connectionID1": { id, remote, close },
 *   "connectionID2": { id, remote, close }
 * }
 */
const connections: Connections = {};

/**
 * Security: Validate Guest Target
 * ────────────────────────────────
 * Validates that a message event actually came from the expected guest.
 * This is crucial for iframe security but not needed for workers.
 *
 * WHY THIS IS NEEDED:
 * ──────────────────
 * iframes can be malicious. A malicious iframe could try to send messages
 * pretending to be a trusted iframe. This function prevents that by checking:
 * 1. event.origin matches the iframe's src origin
 * 2. event.source matches the iframe's contentWindow
 *
 * SECURITY MODEL:
 * ──────────────
 * - Workers: Trusted by default (browser isolation, can't fake messages)
 * - iframes: Must validate origin and source (could be malicious)
 *
 * Example attack prevented:
 * - Trusted iframe at https://trusted.com
 * - Malicious iframe at https://evil.com
 * - Malicious iframe sends message with forged data
 * - This function rejects it because:
 *   - event.origin = "https://evil.com"
 *   - childOrigin = "https://trusted.com"
 *   - They don't match → message rejected
 *
 * SPECIAL CASES:
 * ─────────────
 * - Workers: Always return true (no validation needed)
 * - iframes with no src (about:blank): Allow (return true)
 * - iframes with mismatched origin: Reject (return false)
 *
 * @param guest The guest we're checking (worker or iframe)
 * @param event The message event to validate
 * @returns true if message is from expected guest, false otherwise
 */
function isValidTarget(guest: Guest, event: any) {
  // Workers are trusted (browser isolation prevents message spoofing)
  if (isNodeWorker(guest) || (typeof Worker !== "undefined" && guest instanceof Worker)) {
    return true;
  }

  // For iframes, perform origin and source validation
  const iframe = guest as HTMLIFrameElement;
  try {
    const childURL = iframe.src;
    const childOrigin = getOriginFromURL(childURL);

    // Check 1: Does event.origin match iframe.src origin?
    const hasProperOrigin = event.origin === childOrigin;

    // Check 2: Does event.source match iframe.contentWindow?
    const hasProperSource = event.source === iframe.contentWindow;

    // Allow if both checks pass, or if iframe has no src (about:blank)
    return (hasProperOrigin && hasProperSource) || !childURL;
  } catch (e) {
    console.warn("Error checking iframe target:", e);
    return false;
  }
}

/**
 * Host Connect
 * ────────────
 * Establishes an RPC connection from a host to a guest (worker, iframe, etc).
 *
 * USAGE EXAMPLES:
 * ──────────────
 *
 * Example 1: Connect to Web Worker
 * // In main thread
 * import { host } from 'postbridge';
 *
 * const worker = new Worker('worker.js');
 * const connection = await host.connect(worker, {
 *   getSettings: () => ({ theme: 'dark' }),
 *   processResult: (result) => {
 *     console.log('Got result:', result);
 *   }
 * });
 *
 * // Call worker methods:
 * const result = await connection.remote.processData([1, 2, 3]);
 *
 * // Cleanup when done:
 * connection.close();
 *
 * Example 2: Connect to iframe
 * // In parent window
 * const iframe = document.getElementById('my-iframe');
 * const connection = await host.connect(iframe, {
 *   config: { apiKey: 'abc123' },
 *   notifyUser: (message) => alert(message)
 * });
 *
 * Example 3: Multiple connections
 * const worker1 = new Worker('worker1.js');
 * const worker2 = new Worker('worker2.js');
 * const conn1 = await host.connect(worker1, schema);
 * const conn2 = await host.connect(worker2, schema);
 * // Each has unique connectionID and independent RPC channels
 *
 * HOW IT WORKS:
 * ────────────
 * 1. Generate unique connectionID
 * 2. Determine correct targets for listening/sending based on guest type
 * 3. Set up two handlers:
 *    a. handleHandshake - processes initial HANDSHAKE_REQUEST
 *    b. handleHandshakeReply - waits for confirmation
 * 4. When HANDSHAKE_REQUEST arrives:
 *    - Validate guest (security check for iframes)
 *    - Extract local methods from schema
 *    - Register remote methods (guest → proxy functions)
 *    - Register local methods (host → event handlers)
 *    - Send HANDSHAKE_REPLY with connectionID and methods
 *    - Store connection in global map
 * 5. When confirmation HANDSHAKE_REPLY arrives:
 *    - Resolve promise with Connection object
 * 6. Both sides can now make RPC calls
 *
 * GUEST TYPE DETECTION:
 * ────────────────────
 * The function detects guest type and sets up correct targets:
 *
 * Worker (Web or Node.js):
 * - listenTo: guest (the worker itself)
 * - sendTo: guest (the worker itself)
 *
 * SharedWorker:
 * - listenTo: guest.port (MessagePort)
 * - sendTo: guest.port (MessagePort)
 *
 * iframe:
 * - listenTo: window (main window)
 * - sendTo: event.source (iframe's window)
 *
 * SECURITY:
 * ────────
 * For iframes, validates origin and source to prevent message spoofing.
 * Workers don't need validation (browser-isolated by design).
 *
 * CONNECTION LIFECYCLE:
 * ────────────────────
 * 1. connect() called → Promise created
 * 2. Wait for HANDSHAKE_REQUEST from guest
 * 3. Send HANDSHAKE_REPLY to guest
 * 4. Wait for confirmation HANDSHAKE_REPLY
 * 5. Promise resolves → Connection active
 * 6. Make RPC calls via connection.remote.*
 * 7. connection.close() → Cleanup all listeners
 *
 * CLEANUP:
 * ───────
 * The close() function:
 * - Removes from global connections map
 * - Removes all event listeners (handshake + RPC)
 * - Clears all RPC handlers
 * - Terminates worker (if guest is a worker)
 *
 * Always call close() when done to prevent memory leaks!
 *
 * ERROR HANDLING:
 * ──────────────
 * - Throws if guest is null/undefined
 * - Throws if confirmation arrives but connection doesn't exist
 * - Returns false from isValidTarget if iframe origin doesn't match
 *
 * @param guest The guest to connect to (Worker, iframe, etc.)
 * @param schema Object with functions and data to expose to guest
 * @returns Promise that resolves to Connection object
 */
function connect(guest: Guest, schema: Schema = {}): Promise<Connection> {
  // Validate guest parameter
  if (!guest) throw new Error("a target is required");

  // Detect if guest is a worker (vs iframe)
  const guestIsWorker = isWorkerLike(guest);

  // Determine where to listen for messages based on guest type
  const listenTo =
    guestIsWorker || isNodeEnv()
      ? (guest as Worker) // Workers: listen on worker
      : guest instanceof SharedWorker
        ? guest.port // SharedWorker: listen on port
        : window; // iframe: listen on main window

  return new Promise((resolve) => {
    // Generate unique connection ID
    const connectionID = generateId();

    // Handler for initial HANDSHAKE_REQUEST from guest
    function handleHandshake(event: any) {
      // Determine where to send messages based on guest type
      const sendTo =
        guestIsWorker || isNodeEnv()
          ? (guest as Worker) // Workers: send to worker
          : guest instanceof SharedWorker
            ? guest.port // SharedWorker: send to port
            : event.source; // iframe: send to event.source

      // Security: Validate iframe messages (workers don't need validation)
      if (!guestIsWorker && !isNodeEnv() && !isValidTarget(guest, event)) return;

      const eventData = getEventData(event);

      // Only process HANDSHAKE_REQUEST messages
      if (eventData?.action !== actions.HANDSHAKE_REQUEST) return;

      // Prevent duplicate connections with same ID
      if (connections[connectionID]) return;

      // Extract methods from host schema
      const localMethods = extractMethods(schema);

      // Register remote methods (guest methods → proxy functions)
      // After this, we can call remote.guestMethod()
      const { remote, unregisterRemote } = registerRemoteMethods(
        eventData.schema,
        eventData.methodNames,
        connectionID,
        event,
        listenTo,
        sendTo,
      );

      // Register local methods (host methods → event handlers)
      // After this, guest can call our methods
      // Note: remote is passed for bidirectional RPC
      const unregisterLocal = registerLocalMethods(localMethods, connectionID, listenTo, sendTo, remote);

      // Send HANDSHAKE_REPLY to guest with our methods
      const payload = {
        action: actions.HANDSHAKE_REPLY,
        connectionID,
        schema: schema,
        methodNames: Object.keys(localMethods),
      };
      postMessageToTarget(sendTo, payload, event.origin);

      // Cleanup function for when connection is closed
      const close = () => {
        delete connections[connectionID]; // Remove from global map
        removeEventListener(listenTo, events.MESSAGE, handleHandshake);
        removeEventListener(listenTo, events.MESSAGE, handleHandshakeReply);
        unregisterRemote(); // Remove response listeners
        unregisterLocal(); // Remove request listeners
        // Terminate worker if guest is a worker
        if (guestIsWorker) {
          (guest as Worker).terminate();
        }
      };

      // Create connection object
      const connection: Connection = { remote, close, id: connectionID };
      // Store in global map for later retrieval
      connections[connectionID] = connection;
    }

    // Start listening for HANDSHAKE_REQUEST
    addEventListener(listenTo, events.MESSAGE, handleHandshake);

    // Handler for confirmation HANDSHAKE_REPLY from guest
    function handleHandshakeReply(event: any) {
      const eventData = getEventData(event);

      // Only process HANDSHAKE_REPLY messages
      if (eventData?.action !== actions.HANDSHAKE_REPLY) return;

      // Only process replies for this connection
      if (connectionID !== eventData.connectionID) return;

      // Verify connection exists (should have been created in handleHandshake)
      if (!connections[eventData.connectionID]) {
        throw new Error("PostBridge Error: No connection found for this connectionID");
      }

      // Connection is ready! Resolve promise
      return resolve(connections[eventData.connectionID]);
    }

    // Start listening for confirmation HANDSHAKE_REPLY
    addEventListener(listenTo, events.MESSAGE, handleHandshakeReply);
  });
}

/**
 * Host API Export
 * ──────────────
 * Exports the host.connect() function for use in host contexts.
 *
 * Usage:
 * import { host } from 'postbridge';
 * const worker = new Worker('worker.js');
 * const connection = await host.connect(worker, { ... });
 */
export default {
  connect,
};
