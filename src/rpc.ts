/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * POSTBRIDGE CORE IMPLEMENTATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file contains the core RPC mechanism that powers PostBridge. It handles:
 * - Registering local methods that the remote can call
 * - Creating proxy functions that call remote methods
 * - Managing the request/response cycle
 * - Supporting transferable objects for efficient data passing
 *
 * HOW RPC WORKS (Detailed):
 * ────────────────────────
 * 1. REGISTRATION PHASE (happens during handshake):
 *    - Local methods are registered with event listeners
 *    - Remote methods are turned into proxy functions
 *
 * 2. CALLING PHASE (when you call remote.someMethod(...)):
 *    - Proxy function sends RPC_REQUEST message with args
 *    - Returns a Promise that waits for response
 *
 * 3. EXECUTION PHASE (when remote receives the request):
 *    - Event listener catches the RPC_REQUEST
 *    - Executes the real function
 *    - Sends back RPC_RESOLVE or RPC_REJECT
 *
 * 4. RESPONSE PHASE (when caller receives the response):
 *    - Event listener catches the RPC_RESOLVE/REJECT
 *    - Resolves or rejects the original Promise
 *    - Caller receives the result
 *
 * KEY DESIGN DECISIONS:
 * ────────────────────
 * - BIDIRECTIONAL: Both sides can call each other's methods
 * - ASYNC BY DEFAULT: All RPC calls return Promises
 * - TRANSFERABLES: Support for efficient binary data transfer
 * - CONNECTION-SCOPED: All messages include connectionID for routing
 * - CALL-SCOPED: All RPCs include callID for matching requests/responses
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { addEventListener, generateId, getEventData, postMessageToTarget, removeEventListener, set } from "./helpers";
import {
  actions,
  Environment,
  events,
  PostBridgeEvent,
  RPCRequestPayload,
  RPCResolvePayload,
  Schema,
  Target,
} from "./types";

/**
 * Private Symbol for Transferables
 * ─────────────────────────────────
 * A unique symbol used to attach transferable objects to return values.
 * Symbols are perfect for this because:
 * - They're unique and won't collide with user properties
 * - They don't show up in JSON.stringify (won't be serialized)
 * - They can be used as hidden metadata on objects
 *
 * This symbol is used by withTransferable() to mark which objects should be
 * transferred (not cloned) when sending via postMessage.
 */
const SYM_TRANSFERABLES = Symbol();

/**
 * Register Local Methods
 * ──────────────────────
 * Sets up event listeners for each local method so the remote can call them.
 * This is the "server" side of RPC - it listens for requests and executes them.
 *
 * HOW IT WORKS:
 * ────────────
 * For each method in the local schema:
 * 1. Create an event handler that listens for RPC_REQUEST messages
 * 2. When a request arrives:
 *    - Validate it's for this method and connection
 *    - Execute the method with the provided args
 *    - Send back RPC_RESOLVE (success) or RPC_REJECT (error)
 * 3. Store cleanup functions to remove listeners later
 *
 * BIDIRECTIONAL RPC FEATURE:
 * ─────────────────────────
 * The `remote` parameter is passed as the LAST argument to every local method.
 * This allows local methods to call remote methods, creating truly bidirectional
 * RPC communication.
 *
 * Example:
 * // Host defines:
 * const hostSchema = {
 *   processData: async (data, remote) => {
 *     // Can call guest methods!
 *     const status = await remote.getStatus();
 *     return { processed: data, status };
 *   }
 * };
 *
 * // Guest can call host, host can call guest back
 * await remote.processData([1, 2, 3]);
 *
 * TRANSFERABLES SUPPORT:
 * ─────────────────────
 * If a method returns a value with SYM_TRANSFERABLES attached (via
 * withTransferable), those objects are transferred rather than cloned.
 *
 * ERROR HANDLING:
 * ──────────────
 * Errors are caught, serialized (using JSON with Object.getOwnPropertyNames
 * to preserve stack traces), and sent back as RPC_REJECT messages.
 *
 * CLEANUP:
 * ───────
 * Returns a function that removes all event listeners. This is crucial for
 * preventing memory leaks when closing connections.
 *
 * @param methods Flat map of method paths to functions (from extractMethods)
 * @param rpcConnectionID The connection ID for routing messages
 * @param listenTo Where to listen for incoming RPC requests
 * @param sendTo Where to send RPC responses
 * @param remote The remote API object (for bidirectional calls)
 * @returns Cleanup function that removes all event listeners
 */
export function registerLocalMethods(
  methods: Record<string, (...args: any[]) => any> = {},
  rpcConnectionID: string,
  listenTo: Environment,
  sendTo: Target,
  remote: Schema,
) {
  // Store cleanup functions for all listeners
  const listeners: any[] = [];

  // Register a handler for each local method
  for (const [methodName, method] of Object.entries(methods)) {
    // Handler that executes when remote calls this method
    async function handleCall(event: any) {
      const eventData = getEventData(event);
      const { action, callID, connectionID, callName, args = [] } = eventData as RPCRequestPayload;

      // Validate this is an RPC request for this method and connection
      if (action !== actions.RPC_REQUEST) return;
      if (!callID || !callName) return;
      if (callName !== methodName) return;
      if (connectionID !== rpcConnectionID) return;

      // Prepare the response payload
      const payload: RPCResolvePayload = {
        action: actions.RPC_RESOLVE, // Will change to RPC_REJECT on error
        callID,
        callName,
        connectionID,
        error: null,
        result: null,
      };

      // Extract transferables if present (for efficient binary data transfer)
      let transferables: Transferable[] | undefined = undefined;

      // Execute the function and capture result or error
      try {
        // Pass the remote object as the LAST argument (bidirectional RPC)
        payload.result = await method(...args, remote);

        // Check if result has transferable objects attached
        if (payload.result && payload.result[SYM_TRANSFERABLES]) {
          transferables = payload.result[SYM_TRANSFERABLES] ?? [];
          delete payload.result[SYM_TRANSFERABLES]; // Clean up symbol before sending
        }
      } catch (error) {
        // On error, change action to RPC_REJECT and serialize the error
        payload.action = actions.RPC_REJECT;
        // Serialize error with all properties (including stack, message, etc.)
        payload.error = JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)));
      }

      // Send response back to caller
      postMessageToTarget(sendTo, payload, event?.origin, transferables);
    }

    // Subscribe to message events for this method
    addEventListener(listenTo, events.MESSAGE, handleCall);
    // Store cleanup function
    listeners.push(() => removeEventListener(listenTo, events.MESSAGE, handleCall));
  }

  // Return cleanup function that removes all listeners
  return () => listeners.forEach((unregister) => unregister());
}

/**
 * Create RPC Proxy Function
 * ─────────────────────────
 * Creates a proxy function that makes RPC calls to the remote. This is the
 * "client" side of RPC - it sends requests and waits for responses.
 *
 * HOW IT WORKS:
 * ────────────
 * 1. Returns a function that can be called like a normal function
 * 2. When called:
 *    - Generates a unique callID for this specific invocation
 *    - Sets up a response listener (to catch the result)
 *    - Sends RPC_REQUEST message with args
 *    - Returns a Promise that resolves when response arrives
 * 3. When response arrives:
 *    - Validates it matches this call (callID, callName, connectionID)
 *    - Resolves the Promise with result (or rejects with error)
 *
 * CONCURRENCY SUPPORT:
 * ───────────────────
 * Multiple calls to the same function can be in-flight simultaneously:
 * - Each call gets a unique callID
 * - Each call sets up its own response listener
 * - Responses are matched by callID, so they never get mixed up
 *
 * Example:
 * const fn = createRPC("slowFunction", connID, event, [], listenTo, sendTo);
 * const promise1 = fn(1); // callID: "abc123"
 * const promise2 = fn(2); // callID: "def456"
 * // Both can be pending at the same time, will resolve independently
 *
 * TRANSFERABLES SUPPORT:
 * ─────────────────────
 * If arguments are wrapped with withTransferable(), they'll be transferred
 * rather than cloned for efficiency.
 *
 * Example:
 * const buffer = new ArrayBuffer(1024);
 * await remote.processBuffer(withTransferable(t => t(buffer)));
 * // buffer is transferred, not copied
 *
 * CLEANUP:
 * ───────
 * Response listeners are stored in the `listeners` array for cleanup when
 * the connection closes.
 *
 * @param rpcCallName The name of the remote method to call
 * @param rpcConnectionID The connection ID for routing
 * @param event The original handshake event (for origin)
 * @param listeners Array to store cleanup functions
 * @param listenTo Where to listen for RPC responses
 * @param sendTo Where to send RPC requests
 * @returns A proxy function that makes RPC calls when invoked
 */
export function createRPC(
  rpcCallName: string,
  rpcConnectionID: string,
  event: PostBridgeEvent,
  listeners: Array<() => void> = [],
  listenTo: Environment,
  sendTo: Target,
) {
  // Return a proxy function that can be called like a normal function
  return (...args: any[]) => {
    return new Promise((resolve, reject) => {
      // Generate unique ID for this specific call
      const requestID = generateId();

      // Handler for RPC response
      function handleResponse(event: any) {
        const eventData = getEventData(event);
        const { callID, connectionID, callName, result, error, action } = eventData as RPCResolvePayload;

        // Validate this response is for this specific call
        if (!callID || !callName) return;
        if (callName !== rpcCallName) return; // Not for this method
        if (callID !== requestID) return; // Not for this invocation
        if (connectionID !== rpcConnectionID) return; // Not for this connection

        // Resolve or reject based on action
        if (action === actions.RPC_RESOLVE) return resolve(result);
        if (action === actions.RPC_REJECT) return reject(error);
      }

      // Build the RPC request payload
      const payload = {
        action: actions.RPC_REQUEST,
        args,
        callID: requestID,
        callName: rpcCallName,
        connectionID: rpcConnectionID,
      };

      // Extract transferable objects from arguments
      // Check each arg and also the args array itself for transferables
      const transferables = args.reduce(
        (transferables, arg) =>
          arg[SYM_TRANSFERABLES]?.length ? transferables.concat(arg[SYM_TRANSFERABLES]) : transferables,
        // @ts-expect-error: we know this is an array of transferables (if it exists)
        args[SYM_TRANSFERABLES] ?? [],
      );

      // Set up response listener
      addEventListener(listenTo, events.MESSAGE, handleResponse);
      // Store cleanup function
      listeners.push(() => removeEventListener(listenTo, events.MESSAGE, handleResponse));

      // Send the RPC request
      postMessageToTarget(sendTo, payload, event?.origin, transferables);
    });
  };
}

/**
 * Register Remote Methods
 * ───────────────────────
 * Creates a proxy object with callable functions for each remote method.
 * This is what you get back as `connection.remote` - an object where each
 * property is a function that makes RPC calls.
 *
 * HOW IT WORKS:
 * ────────────
 * 1. Start with a copy of the remote's schema (contains non-function data)
 * 2. For each method name:
 *    - Create an RPC proxy function using createRPC()
 *    - Set it on the remote object at the correct path (using dot notation)
 * 3. Return the remote object and cleanup function
 *
 * Example:
 * // Remote sent methodNames: ["add", "math.multiply"]
 * // This creates:
 * remote = {
 *   add: (...args) => RPC_CALL("add", args),
 *   math: {
 *     multiply: (...args) => RPC_CALL("math.multiply", args)
 *   }
 * }
 *
 * NESTED METHODS:
 * ──────────────
 * Method names can use dot notation for nested APIs:
 * - "add" → remote.add()
 * - "math.multiply" → remote.math.multiply()
 * - "utils.string.capitalize" → remote.utils.string.capitalize()
 *
 * The `set()` helper creates intermediate objects as needed.
 *
 * SCHEMA PRESERVATION:
 * ───────────────────
 * The remote's non-function schema data is preserved in the remote object.
 * This allows passing configuration or initial state during handshake.
 *
 * Example:
 * // Remote schema: { config: { timeout: 5000 }, add: fn }
 * // After registration:
 * remote.config.timeout // 5000 (data preserved)
 * remote.add(1, 2) // RPC call
 *
 * CLEANUP:
 * ───────
 * Returns an unregisterRemote function that removes all response listeners.
 * This is called when the connection closes.
 *
 * @param schema The remote's schema (functions already removed, data preserved)
 * @param methodNames Array of method paths (e.g., ["add", "math.multiply"])
 * @param connectionID The connection ID for routing
 * @param event The handshake event (for origin)
 * @param listenTo Where to listen for RPC responses
 * @param sendTo Where to send RPC requests
 * @returns Object with remote (proxy object) and unregisterRemote (cleanup)
 */
export function registerRemoteMethods(
  schema: Schema = {},
  methodNames: Iterable<string> = [],
  connectionID: string,
  event: PostBridgeEvent,
  listenTo: Environment,
  sendTo: Target,
) {
  // Start with a copy of the schema (preserves non-function data)
  const remote = { ...schema };
  // Store cleanup functions for all response listeners
  const listeners: Array<() => void> = [];

  // Create a proxy function for each remote method
  for (const methodName of methodNames) {
    const rpc = createRPC(methodName, connectionID, event, listeners, listenTo, sendTo);
    // Set the RPC function at the correct path (handles dot notation)
    set(remote, methodName, rpc);
  }

  return {
    remote, // The proxy object with callable RPC functions
    unregisterRemote: () => listeners.forEach((unregister) => unregister()), // Cleanup
  };
}

/**
 * With Transferable Wrapper
 * ─────────────────────────
 * Marks objects as "transferable" for efficient postMessage transfer.
 *
 * WHAT ARE TRANSFERABLES?
 * ──────────────────────
 * Normally, postMessage *clones* data (creates a copy). For large binary data
 * (ArrayBuffer, MessagePort, ImageBitmap, etc.), cloning is expensive.
 *
 * Transferables are *moved* instead of cloned:
 * - Ownership transfers to the receiver
 * - Original context loses access (becomes detached/unusable)
 * - Zero-copy operation (very fast for large data)
 *
 * WHY THIS FUNCTION?
 * ─────────────────
 * postMessage requires transferables to be listed separately:
 * postMessage(data, [transferable1, transferable2])
 *
 * This function provides a nice API to mark transferables while building
 * the data structure, then extracts them automatically when sending.
 *
 * HOW IT WORKS:
 * ────────────
 * 1. You provide a callback that builds your return value
 * 2. The callback receives a `transfer()` function
 * 3. Call `transfer(obj)` for each object you want transferred
 * 4. The function attaches a hidden list of transferables to the result
 * 5. RPC code extracts this list when calling postMessage
 *
 * Examples:
 *
 * // Returning a single transferable:
 * return withTransferable((transfer) => {
 *   const buffer = new ArrayBuffer(1024);
 *   return transfer(buffer);
 * });
 * // buffer is transferred, not cloned
 *
 * // Returning an object with transferable properties:
 * return withTransferable((transfer) => ({
 *   data: someData,
 *   buffer: transfer(new ArrayBuffer(1024)),
 *   stream: transfer(new ReadableStream())
 * }));
 * // buffer and stream are transferred, data is cloned
 *
 * // Passing transferable arguments to RPC:
 * const buffer = new ArrayBuffer(1024);
 * await remote.processBuffer(
 *   withTransferable((transfer) => transfer(buffer))
 * );
 * // buffer is transferred to remote
 *
 * IMPORTANT NOTES:
 * ───────────────
 * - After transferring, the original object becomes detached/unusable
 * - Only certain types can be transferred (ArrayBuffer, MessagePort, etc.)
 * - Regular objects/arrays are always cloned, even if you call transfer() on them
 * - The transfer() function returns its input (for convenient chaining)
 *
 * @param cb Callback that receives transfer() function and returns result
 * @returns The callback's result with transferables attached
 */
export const withTransferable = <Transferable, Result extends object>(
  cb: (transfer: <T extends Transferable>(transferable: T) => T) => Result,
) => {
  // Array to collect transferable objects
  const transferables: Transferable[] = [];

  // Function passed to callback - marks an object as transferable
  const transfer = <T extends Transferable>(transferable: T) => {
    transferables.push(transferable);
    return transferable; // Return for convenient chaining
  };

  // Execute the callback to build the result
  const result = cb(transfer);

  // Attach the list of transferables to the result using our private symbol
  return Object.assign(result, { [SYM_TRANSFERABLES]: transferables });
};
