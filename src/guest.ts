/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * POSTBRIDGE GUEST (CLIENT) IMPLEMENTATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file implements the guest-side connection logic. A "guest" is code running
 * in an isolated context (Web Worker, iframe, or Node.js Worker thread) that wants
 * to communicate with a "host" (usually the main thread or parent window).
 *
 * GUEST vs HOST:
 * ─────────────
 * - GUEST: The child context (worker, iframe). Usually started by the host.
 * - HOST: The parent context (main thread, parent window). Manages guests.
 *
 * Example scenarios:
 * - Main page (host) ↔ Web Worker (guest)
 * - Parent window (host) ↔ iframe (guest)
 * - Node.js main thread (host) ↔ Worker thread (guest)
 *
 * GUEST RESPONSIBILITIES:
 * ──────────────────────
 * 1. Auto-detect the host (parent window, self for workers, parentPort for Node)
 * 2. Initiate the handshake by sending HANDSHAKE_REQUEST
 * 3. Wait for HANDSHAKE_REPLY from host
 * 4. Register RPC handlers for both directions
 * 5. Confirm handshake completion with second HANDSHAKE_REPLY
 * 6. Return Connection object for making RPC calls
 *
 * THE HANDSHAKE FLOW (Guest Perspective):
 * ───────────────────────────────────────
 * 1. Guest calls guest.connect(schema)
 * 2. Guest sends HANDSHAKE_REQUEST → Host
 *    - Includes guest's method names and schema
 * 3. Host sends HANDSHAKE_REPLY → Guest
 *    - Includes host's method names and schema
 *    - Includes connectionID for routing
 * 4. Guest processes reply:
 *    - Creates proxy functions for host methods (remote.*)
 *    - Registers handlers for local methods
 * 5. Guest sends HANDSHAKE_REPLY → Host (confirmation)
 * 6. Connection established! Both sides can now make RPC calls
 *
 * WHY TWO HANDSHAKE_REPLY MESSAGES?
 * ─────────────────────────────────
 * The second HANDSHAKE_REPLY is a confirmation that the guest has finished
 * setting up its handlers. This prevents race conditions where the host might
 * try to call a guest method before the guest is ready to receive it.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  extractMethods,
  getEventData,
  getTargetHost,
  postMessageToTarget,
  addEventListener,
  removeEventListener,
} from "./helpers";
import { registerLocalMethods, registerRemoteMethods } from "./rpc";
import { actions, GuestConnectOptions, events, Connection, Schema } from "./types";

/**
 * Guest Connect
 * ─────────────
 * Establishes an RPC connection from a guest context to its host.
 *
 * USAGE EXAMPLES:
 * ──────────────
 *
 * Example 1: Simple Web Worker
 * // Inside worker.js
 * import { guest } from 'postbridge';
 *
 * const connection = await guest.connect({
 *   processData: (data) => {
 *     return data.map(x => x * 2);
 *   }
 * });
 *
 * // Now can call host methods:
 * const result = await connection.remote.hostMethod();
 *
 * Example 2: iframe with configuration
 * // Inside iframe
 * import { guest } from 'postbridge';
 *
 * const connection = await guest.connect({
 *   config: { version: '1.0' },  // Non-function data
 *   renderChart: (chartData) => {
 *     // Render chart in iframe
 *   }
 * }, {
 *   onConnectionSetup: async (remote) => {
 *     // Initialize with data from host
 *     const settings = await remote.getSettings();
 *     applySettings(settings);
 *   }
 * });
 *
 * HOW IT WORKS:
 * ────────────
 * 1. Extract methods from schema (functions → method map)
 * 2. Auto-detect host target (or use provided one)
 * 3. Set up handshake response listener
 * 4. Send HANDSHAKE_REQUEST to host
 * 5. When HANDSHAKE_REPLY arrives:
 *    - Register remote methods (host → proxy functions)
 *    - Register local methods (guest → event handlers)
 *    - Call onConnectionSetup if provided
 *    - Send confirmation HANDSHAKE_REPLY
 *    - Resolve promise with Connection object
 *
 * AUTO-DETECTION:
 * ──────────────
 * If hostTarget is not provided, it's auto-detected:
 * - Web Worker → self
 * - iframe → window.parent
 * - Node.js Worker → parentPort
 *
 * OPTIONS:
 * ───────
 * - hostTarget: Override auto-detection (advanced use cases)
 * - onConnectionSetup: Async callback for initialization
 *   - Receives remote object as parameter
 *   - Can call remote methods before connection resolves
 *   - Useful for loading initial state
 *
 * RETURN VALUE:
 * ────────────
 * Connection object with:
 * - id: Unique connection identifier
 * - remote: Proxy object for calling host methods
 * - close(): Function to tear down connection and cleanup
 *
 * CLEANUP:
 * ───────
 * Always call connection.close() when done to prevent memory leaks:
 * - Removes all event listeners
 * - Clears RPC handlers
 * - Invalidates the connection
 *
 * @param schema Object with functions and data to expose to host
 * @param options Configuration options (hostTarget, onConnectionSetup)
 * @returns Promise that resolves to Connection object
 */
function connect(schema: Schema = {}, options?: GuestConnectOptions): Promise<Connection> {
  return new Promise(async (resolve) => {
    // Extract methods from schema (separates functions from data)
    const localMethods = extractMethods(schema);

    // Determine where to send messages (host) and where to listen
    const sendTo = options?.hostTarget ?? getTargetHost();
    const listenTo = options?.hostTarget ?? (self || window);

    // Handler for HANDSHAKE_REPLY from host
    async function handleHandshakeResponse(event: any) {
      const eventData = getEventData(event);

      // Ignore messages that aren't HANDSHAKE_REPLY
      if (eventData?.action !== actions.HANDSHAKE_REPLY) return;

      // Create proxy functions for host methods
      // After this, we can call remote.hostMethod()
      const { remote, unregisterRemote } = registerRemoteMethods(
        eventData.schema,
        eventData.methodNames,
        eventData.connectionID,
        event,
        listenTo,
        sendTo,
      );

      // Register handlers for guest methods
      // After this, host can call our methods
      // Note: remote is passed so local methods can call host methods (bidirectional)
      const unregisterLocal = registerLocalMethods(localMethods, eventData.connectionID, listenTo, sendTo, remote);

      // Optional: Run initialization callback with remote API
      // This allows loading initial state before connection resolves
      await options?.onConnectionSetup?.(remote);

      // Send confirmation that we're ready
      const payload = {
        action: actions.HANDSHAKE_REPLY,
        connectionID: eventData.connectionID,
      };
      postMessageToTarget(sendTo, payload, event?.origin);

      // Cleanup function for when connection is closed
      const close = () => {
        removeEventListener(listenTo, events.MESSAGE, handleHandshakeResponse);
        unregisterRemote(); // Remove response listeners
        unregisterLocal(); // Remove request listeners
      };

      // Create and resolve connection object
      const connection = { remote, close, id: eventData.connectionID };
      return resolve(connection);
    }

    // Start listening for HANDSHAKE_REPLY
    addEventListener(listenTo, events.MESSAGE, handleHandshakeResponse);

    // Send HANDSHAKE_REQUEST to initiate connection
    const payload = {
      action: actions.HANDSHAKE_REQUEST,
      methodNames: Object.keys(localMethods),
      schema: schema, // Schema with functions removed, data preserved
    };
    postMessageToTarget(sendTo, payload);
  });
}

/**
 * Guest API Export
 * ───────────────
 * Exports the guest.connect() function for use in guest contexts.
 *
 * Usage:
 * import { guest } from 'postbridge';
 * const connection = await guest.connect({ ... });
 */
export default {
  connect,
};
