/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BRIDGE - CROSS-TAB BROADCASTING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bridge is PostBridge's cross-tab broadcasting feature using SharedWorkers.
 * It brings PostBridge's clean RPC design to 1:N communication across tabs.
 *
 * CORE CONCEPT:
 * ────────────
 * One tab calls a function → All tabs execute it automatically
 * Just like PostBridge, your schema functions ARE the handlers!
 *
 * Example:
 * // Define schema (same code in all tabs)
 * const schema = {
 *   updateCount: (count, remote) => {
 *     state.count = count;
 *     updateUI(count);  // This runs in ALL tabs!
 *   }
 * };
 *
 * // Tab 1
 * await conn.remote.updateCount(42);
 * // ✓ Executes locally (Tab 1's UI updates)
 * // ✓ Broadcasts to Tab 2, Tab 3, etc (their UIs update)
 *
 * KEY FEATURES:
 * ────────────
 * ✓ Single Schema Definition: Define functions once in tabs, not in worker
 * ✓ PostBridge-Style API: connection.remote.method(args) - clean and simple
 * ✓ Broadcast Semantics: Caller executes locally, others execute automatically
 * ✓ No Echo: Sender doesn't receive own broadcasts
 * ✓ Type Safety: Full TypeScript support with inference
 * ✓ Direct Messaging: Send to specific tabs with remote(tabID)
 * ✓ Zero Configuration: Worker code embedded as Blob URL
 *
 * ARCHITECTURE:
 * ────────────
 * Tab A: calls remote.method(args)
 *   ↓ 1. Execute locally
 *   ↓ 2. Get result
 *   ↓ 3. Broadcast to SharedWorker
 * SharedWorker (dumb relay):
 *   ↓ 4. Relay to Tab B, Tab C, Tab D (exclude Tab A)
 * Tabs B,C,D:
 *   ↓ 5. Execute same method(args) - schema function runs
 *
 * USAGE:
 * ─────
 * ```typescript
 * import { bridge } from 'postbridge';
 *
 * // Define schema once
 * const schema = {
 *   updateCount: (count, remote) => {
 *     // This function runs in ALL tabs
 *     remote.count = count;
 *     updateUI(count);
 *   },
 *   setUser: (user, remote) => {
 *     remote.user = user;
 *     renderUser(user);
 *   }
 * };
 *
 * // Connect
 * const conn = await bridge.connect(schema);
 *
 * // Broadcast to all other tabs
 * await conn.remote.updateCount(42);
 * // Returns 42 (local result)
 * // All other tabs execute updateCount(42) automatically
 *
 * // Cleanup
 * conn.close();
 * ```
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { extractMethods, generateId, set } from "./helpers";
import {
  Schema,
  BridgeConnection,
  BridgeConnectOptions,
  bridgeActions,
  BridgeHandshakePayload,
  BridgeHandshakeAckPayload,
  BridgeHandshakeErrorPayload,
  BridgeBroadcastPayload,
  BridgeRelayPayload,
  BridgeGetTabsPayload,
  BridgeDirectMessagePayload,
} from "./types";

/**
 * Create SharedWorker from Code
 * ─────────────────────────────
 * Creates a SharedWorker instance.
 *
 * Strategy:
 * 1. If workerURL is provided, use it directly (recommended for production)
 * 2. Otherwise, use bundler's native worker import (Vite/Webpack/etc)
 *
 * If neither works, this will throw an error at build/runtime.
 * This is intentional - we want to fail fast rather than silently degrade.
 *
 * @param workerURL Optional custom worker URL
 * @returns SharedWorker instance
 * @throws Error if worker cannot be loaded and no workerURL provided
 */
function createSharedWorker(workerURL?: string): SharedWorker {
  if (workerURL) {
    // Use custom worker URL (recommended for production)
    return new SharedWorker(workerURL, { type: "module" });
  }

  // Use bundler's native worker import
  // This will be handled by Vite/Webpack/Rollup during build
  // If your bundler doesn't support this, provide a workerURL option
  return new SharedWorker(new URL("./bridge-worker.ts", import.meta.url), {
    type: "module",
    name: "bridge-worker",
  });
}

/**
 * Create Broadcast Proxy Function
 * ───────────────────────────────
 * Creates a proxy function that executes locally and broadcasts to other tabs.
 *
 * Flow:
 * 1. Execute method locally with provided args + remote as last arg (PostBridge style!)
 * 2. Capture result or error
 * 3. Send BRIDGE_BROADCAST to SharedWorker with ONLY serializable args
 * 4. Return result to caller
 *
 * This ensures:
 * - Caller gets immediate result (no network delay)
 * - Other tabs receive broadcast asynchronously
 * - Consistent behavior across all tabs
 * - Functions can access remote (like PostBridge bidirectional RPC)
 *
 * @param methodName The name of the method to broadcast
 * @param methodFn The actual function to execute
 * @param tabID The unique ID of this tab
 * @param port The MessagePort to SharedWorker
 * @param remote The remote object (for PostBridge-style bidirectional access)
 * @returns A proxy function that broadcasts when called
 */
function createBroadcastProxy(
  methodName: string,
  methodFn: (...args: any[]) => any,
  tabID: string,
  port: MessagePort,
  remote: Schema,
  channel: string,
) {
  return async (...args: any[]) => {
    let result: any;
    let error: any;

    // Step 1: Execute locally with remote as last arg (PostBridge pattern!)
    try {
      result = await methodFn(...args, remote);
    } catch (e) {
      error = e;
    }

    // Step 2: Broadcast to other tabs on same channel (only send serializable args, not remote)
    const broadcastPayload: BridgeBroadcastPayload = {
      action: bridgeActions.BRIDGE_BROADCAST,
      senderTabID: tabID,
      channel,
      methodName,
      args, // Only the serializable arguments, not remote
      result,
      error: error ? JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error))) : undefined,
    };

    try {
      port.postMessage(broadcastPayload);
    } catch (e) {
      console.error(`[Bridge] Failed to broadcast ${methodName}:`, e);
    }

    // Step 3: Return local result (or throw local error)
    if (error) throw error;
    return result;
  };
}

/**
 * Create Direct Message Proxy Function
 * ────────────────────────────────────
 * Creates a proxy function that executes locally and sends to a specific tab only.
 *
 * @param methodName The name of the method to call
 * @param methodFn The actual function to execute
 * @param tabID The unique ID of this tab (sender)
 * @param targetTabID The ID of the target tab to send to
 * @param port The MessagePort to SharedWorker
 * @param remote The remote object (for PostBridge-style bidirectional access)
 * @param channel The channel both tabs are on
 * @returns A proxy function that sends direct message when called
 */
function createDirectMessageProxy(
  methodName: string,
  methodFn: (...args: any[]) => any,
  tabID: string,
  targetTabID: string,
  port: MessagePort,
  remote: Schema,
  channel: string,
) {
  return async (...args: any[]) => {
    let result: any;
    let error: any;

    // Step 1: Execute locally with remote as last arg (PostBridge pattern!)
    try {
      result = await methodFn(...args, remote);
    } catch (e) {
      error = e;
    }

    // Step 2: Send direct message to target tab only
    const directMessagePayload: BridgeDirectMessagePayload = {
      action: bridgeActions.BRIDGE_DIRECT_MESSAGE,
      senderTabID: tabID,
      targetTabID,
      channel,
      methodName,
      args, // Only the serializable arguments, not remote
      result,
      error: error ? JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error))) : undefined,
    };

    try {
      port.postMessage(directMessagePayload);
    } catch (e) {
      console.error(`[Bridge] Failed to send direct message ${methodName} to ${targetTabID}:`, e);
    }

    // Step 3: Return local result (or throw local error)
    if (error) throw error;
    return result;
  };
}

/**
 * Bridge Connect
 * ───────────────────
 * Establishes a cross-tab broadcasting connection via SharedWorker.
 *
 * FLOW:
 * ────
 * 1. Extract methods from schema
 * 2. Create SharedWorker (or use provided URL)
 * 3. Send BRIDGE_HANDSHAKE with tabID and method names
 * 4. Wait for BRIDGE_HANDSHAKE_ACK
 * 5. Create broadcast proxy functions for each method
 * 6. Set up relay handler for broadcasts from other tabs
 * 7. Return BridgeConnection with remote, getConnectedTabs, close
 *
 * BROADCAST SEMANTICS:
 * ───────────────────
 * When calling remote.method(args):
 * - Method executes locally first
 * - Result is returned to caller
 * - Broadcast is sent to all other tabs
 * - Other tabs execute the same schema function automatically
 * - Sender does NOT receive own broadcast (no echo)
 *
 * POSTBRIDGE PHILOSOPHY:
 * ──────────────────────
 * Just like PostBridge, your schema functions ARE the handlers!
 * No need to set up separate listeners - the functions you define
 * execute automatically in all tabs when any tab calls them.
 *
 * CLEANUP:
 * ───────
 * Always call conn.close() when done:
 * - Sends BRIDGE_DISCONNECT
 * - Closes MessagePort
 *
 * @param schema Object with functions to broadcast
 * @param options Optional configuration (workerURL, channel, tabID)
 * @returns Promise that resolves to BridgeConnection
 */
async function connect(schema: Schema = {}, options?: BridgeConnectOptions): Promise<BridgeConnection> {
  return new Promise((resolve, reject) => {
    try {
      // Step 1: Generate unique tab ID (or use provided one)
      const tabID = options?.tabID || generateId();

      // Step 1.5: Get channel name (default: "default" for backward compatibility)
      const channel = options?.channel || "default";

      // Step 2: Extract methods from schema
      const methods = extractMethods(schema);
      const methodNames = Object.keys(methods);

      // Step 3: Create SharedWorker
      const worker = createSharedWorker(options?.workerURL);
      const port = worker.port;

      // Step 4: Set up message handler for handshake and state updates from worker
      const sharedStateCache: Record<string, any> = {};

      port.onmessage = async (event: MessageEvent) => {
        const data = event.data;

        switch (data.action) {
          case bridgeActions.BRIDGE_HANDSHAKE_ACK:
            // Handshake complete - connection ready
            handleHandshakeAck(data as BridgeHandshakeAckPayload);
            break;

          case bridgeActions.BRIDGE_HANDSHAKE_ERROR:
            // Handshake failed - reject connection
            const errorPayload = data as BridgeHandshakeErrorPayload;
            console.error(`[Bridge] Handshake error (${errorPayload.code}):`, errorPayload.error);
            reject(new Error(`Bridge handshake failed: ${errorPayload.error}`));
            break;

          case bridgeActions.BRIDGE_STATE_UPDATE:
            // Worker broadcasted a state change - update our cache
            sharedStateCache[data.key] = data.value;
            break;

          // BRIDGE_RELAY will be handled by the updated handler in handleHandshakeAck
        }
      };

      /**
       * Handle Handshake Acknowledgment
       * ───────────────────────────────
       * Called when SharedWorker confirms connection.
       * Builds the BridgeConnection and resolves promise.
       */
      function handleHandshakeAck(payload: BridgeHandshakeAckPayload) {
        if (payload.tabID !== tabID) return;

        // Build remote object with broadcast proxy functions and shared state
        // remote will be both an object (for broadcasts) and a function (for direct messages)
        const remoteBase: Schema = { ...schema };

        // Initialize shared state cache
        if (payload.sharedState) {
          Object.assign(sharedStateCache, payload.sharedState);

          // Add shared state as reactive properties on remoteBase
          for (const key of Object.keys(payload.sharedState)) {
            Object.defineProperty(remoteBase, key, {
              get() {
                return sharedStateCache[key];
              },
              set(newValue) {
                // Update local cache
                sharedStateCache[key] = newValue;
                // Send update to worker (it will broadcast to all tabs)
                port.postMessage({
                  action: bridgeActions.BRIDGE_SET_STATE,
                  key,
                  value: newValue,
                  channel,
                });
              },
              enumerable: true,
              configurable: true,
            });
          }
        }

        // Add broadcast proxy methods to remoteBase
        for (const [methodName, methodFn] of Object.entries(methods)) {
          const broadcastProxy = createBroadcastProxy(methodName, methodFn, tabID, port, remoteBase, channel);
          set(remoteBase, methodName, broadcastProxy);
        }

        // Create remote as a callable function that also has properties
        // We need to use a function as the Proxy target for it to be callable
        const remoteFn = function (targetTabID: string) {
          // When called as function: remote(tabID) - returns object for direct messaging
          if (typeof targetTabID !== "string") {
            throw new Error("remote(tabID) requires a string tab ID");
          }

          // Create a new object with direct message proxies
          const directRemote: Schema = {};
          for (const [methodName, methodFn] of Object.entries(methods)) {
            const directProxy = createDirectMessageProxy(
              methodName,
              methodFn,
              tabID,
              targetTabID,
              port,
              remoteBase, // Still pass remoteBase so functions can access shared state
              channel,
            );
            directRemote[methodName] = directProxy;
          }
          return directRemote;
        };

        // Copy all properties from remoteBase to the function
        Object.assign(remoteFn, remoteBase);

        // Create a Proxy to handle property access
        const remote = new Proxy(remoteFn, {
          // When accessed as object: remote.method() - broadcasts to all tabs
          get(target, prop, receiver) {
            // First check if it's on the function itself (methods and state)
            if (prop in target) {
              return Reflect.get(target, prop, receiver);
            }
            return undefined;
          },
          set(target, prop, value, receiver) {
            return Reflect.set(target, prop, value, receiver);
          },
        }) as Schema & ((targetTabID: string) => Schema);

        /**
         * Handle Relay (defined here where remote is in scope)
         * ───────────
         * Called when receiving a broadcast from another tab.
         *
         * Flow:
         * 1. Execute method locally with same args + remote as last arg (PostBridge style!)
         *
         * Note: Sender is excluded by worker, so no echo handling needed here.
         */
        async function handleRelay(payload: BridgeRelayPayload) {
          const { methodName, args } = payload;

          // Get the method function
          const methodFn = methods[methodName];
          if (!methodFn) {
            console.warn(`[Bridge] Method ${methodName} not found in schema`);
            return;
          }

          // Execute locally with remote as last arg (PostBridge pattern!)
          try {
            await methodFn(...args, remote);
          } catch (error) {
            console.error(`[Bridge] Error executing ${methodName}:`, error);
          }
        }

        // Update the port message handler to use the local handleRelay
        const originalOnMessage = port.onmessage;
        port.onmessage = async (event: MessageEvent) => {
          const data = event.data;

          if (data.action === bridgeActions.BRIDGE_RELAY) {
            await handleRelay(data as BridgeRelayPayload);
          } else if (originalOnMessage) {
            // Forward other messages to original handler
            originalOnMessage.call(port, event);
          }
        };

        /**
         * Get Connected Tabs
         * ─────────────────
         * Requests list of all connected tab IDs on this channel.
         * @returns Promise that resolves to array of tab IDs
         */
        function getConnectedTabs(): Promise<string[]> {
          return new Promise((resolve) => {
            // Create one-time listener for BRIDGE_TABS_RESPONSE
            const responseHandler = (event: MessageEvent) => {
              const data = event.data;
              if (data.action === bridgeActions.BRIDGE_TABS_RESPONSE && data.channel === channel) {
                // Remove this listener
                port.removeEventListener("message", responseHandler);
                // Resolve with tab IDs
                resolve(data.tabIDs || []);
              }
            };

            // Add temporary listener
            port.addEventListener("message", responseHandler);

            // Send request
            const getTabsPayload: BridgeGetTabsPayload = {
              action: bridgeActions.BRIDGE_GET_TABS,
              channel,
              requestingTabID: tabID,
            };
            port.postMessage(getTabsPayload);
          });
        }

        /**
         * Close Connection
         * ───────────────
         * Disconnects from SharedWorker and cleans up.
         */
        function close(): void {
          // Send disconnect message
          const disconnectPayload = {
            action: bridgeActions.BRIDGE_DISCONNECT,
            tabID,
            channel,
          };
          port.postMessage(disconnectPayload);

          // Close port
          port.close();
        }

        // Build connection object
        const connection: BridgeConnection = {
          id: tabID,
          remote,
          getConnectedTabs,
          close,
        };

        // Resolve promise
        resolve(connection);
      }

      // Step 6: Send handshake to SharedWorker with schema (for shared state) and channel
      const handshakePayload: BridgeHandshakePayload = {
        action: bridgeActions.BRIDGE_HANDSHAKE,
        tabID,
        methodNames,
        schema, // Send non-function properties for shared state
        channel, // Channel for state isolation
      };

      port.start();
      port.postMessage(handshakePayload);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Bridge API Export
 * ──────────────────────
 * Exports the connect function for use in tabs.
 *
 * Usage:
 * import { bridge } from 'postbridge';
 * const conn = await bridge.connect({ ... });
 */
export default {
  connect,
};
