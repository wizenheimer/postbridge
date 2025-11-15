/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * POSTBRIDGE HELPER UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file contains utility functions that abstract away environment-specific
 * differences between browsers, Web Workers, Node.js Workers, and iframes.
 *
 * WHY THESE HELPERS ARE NEEDED:
 * ─────────────────────────────
 * JavaScript can run in many different contexts:
 * 1. Main browser window (window object exists)
 * 2. Web Worker (self exists, window doesn't)
 * 3. Node.js main thread (process object exists)
 * 4. Node.js Worker thread (worker_threads module)
 * 5. iframe (window exists but window.parent !== window)
 * 6. SharedWorker (accessed via MessagePort)
 *
 * Each environment has different APIs for:
 * - Detecting the environment type
 * - Sending messages (postMessage)
 * - Receiving messages (addEventListener/on)
 * - Managing event listeners (removeEventListener/off)
 *
 * These helpers provide a unified interface so the rest of the codebase doesn't
 * need to worry about these differences.
 *
 * KEY CONCEPTS:
 * ────────────
 * - ENVIRONMENT DETECTION: Identifying where code is running
 * - MESSAGE PASSING: Sending data between contexts via postMessage
 * - EVENT HANDLING: Subscribing/unsubscribing from message events
 * - PATH MANIPULATION: Working with nested object properties for namespaced APIs
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Guest, NodeWorker, Target, WorkerLike } from "./types";

/**
 * Environment Detection: Web Worker
 * ──────────────────────────────────
 * Checks if the current code is running inside a Web Worker (browser).
 *
 * How it works:
 * - Web Workers don't have access to the `window` object (security isolation)
 * - But they do have access to `self` (global object in workers)
 * - If window is undefined and self is defined, we're in a worker
 *
 * Why this matters:
 * - Workers can't access the DOM but can do heavy computation
 * - Different message passing APIs than main thread
 * - Different global scope (self vs window)
 *
 * Example usage:
 * if (isWorker()) {
 *   // We're in a worker, can use self.postMessage()
 * }
 *
 * @returns true if running in a Web Worker, false otherwise
 */
export function isWorker(): boolean {
  return typeof window === "undefined" && typeof self !== "undefined";
}

/**
 * Environment Detection: Node.js
 * ───────────────────────────────
 * Checks if the current code is running in Node.js (not browser).
 *
 * How it works:
 * - Node.js has a global `process` object with version information
 * - `process.versions.node` exists only in Node.js
 * - Browsers don't have this property
 *
 * Why this matters:
 * - Node.js has different APIs (no window, no DOM, but has fs, http, etc.)
 * - Worker threads in Node.js use different APIs than Web Workers
 * - Need to require() modules instead of importing browser APIs
 *
 * Example usage:
 * if (isNodeEnv()) {
 *   // Can use Node.js APIs like require('worker_threads')
 * }
 *
 * @returns true if running in Node.js, false otherwise
 */
export function isNodeEnv(): boolean {
  return typeof process !== "undefined" && !!(process as any).versions?.node;
}

/**
 * Environment Detection: iframe
 * ──────────────────────────────
 * Checks if the current code is running inside an iframe.
 *
 * How it works:
 * - In a regular window: window.self === window.top (they're the same)
 * - In an iframe: window.self !== window.top (iframe is nested)
 * - window.self always refers to the current window
 * - window.top refers to the topmost window in the frame hierarchy
 *
 * Why this matters:
 * - iframes need to communicate with parent window via postMessage
 * - Security restrictions apply (same-origin policy)
 * - Different context for accessing global variables
 *
 * Example usage:
 * if (isIframe()) {
 *   // We're in an iframe, can use window.parent.postMessage()
 * }
 *
 * @returns true if running in an iframe, false otherwise
 */
export function isIframe() {
  return window.self !== window.top;
}

/**
 * Schema Processing: Extract Methods
 * ───────────────────────────────────
 * Recursively extracts all functions from a nested object and returns them as
 * a flat map with dot-notation paths. This is necessary because functions
 * cannot be serialized and sent via postMessage.
 *
 * THE PROBLEM:
 * postMessage can only send serializable data (JSON-compatible). Functions,
 * DOM nodes, and other complex objects cannot be sent directly.
 *
 * THE SOLUTION:
 * 1. Extract all functions from the schema object
 * 2. Store them in a flat map with their paths (e.g., "math.add")
 * 3. Remove the functions from the original object (mutates it)
 * 4. Send the function names (strings) via postMessage
 * 5. The receiver creates proxy functions using these names
 *
 * Example:
 * Input schema:
 * {
 *   add: (a, b) => a + b,
 *   math: {
 *     multiply: (a, b) => a * b,
 *     divide: (a, b) => a / b
 *   },
 *   config: { timeout: 5000 }  // non-function data
 * }
 *
 * Output methods:
 * {
 *   "add": [Function],
 *   "math.multiply": [Function],
 *   "math.divide": [Function]
 * }
 *
 * Modified schema (original object is mutated):
 * {
 *   math: {},
 *   config: { timeout: 5000 }  // non-function data preserved
 * }
 *
 * How it works:
 * - Recursively traverses the object tree
 * - When it finds a function, extracts it with its full path
 * - Deletes the function from the original object
 * - Non-function values (numbers, strings, objects) are left intact
 *
 * Why delete from original?
 * - The modified schema is sent via postMessage during handshake
 * - We don't want to lose non-function configuration data
 * - Functions must be removed because they can't be serialized
 *
 * @param obj The schema object to extract methods from (will be mutated!)
 * @returns A flat map of method paths to functions
 */
export function extractMethods(obj: any) {
  const methods: Record<string, (...args: any) => any> = {};

  // Recursive inner function to traverse object tree
  (function parse(obj: any, path = "") {
    Object.keys(obj).forEach((prop) => {
      // Build dot-notation path (e.g., "math.add")
      const propPath = path ? `${path}.${prop}` : prop;

      // If this property is an object (not null, not function), recurse into it
      if (obj[prop] === Object(obj[prop])) {
        parse(obj[prop], propPath);
      }

      // If this property is a function, extract it
      if (typeof obj[prop] === "function") {
        methods[propPath] = obj[prop];
        delete obj[prop]; // Remove from original object
      }
    });
  })(obj);

  return methods;
}

/**
 * URL Origin Parsing
 * ──────────────────
 * Regular expression to extract protocol, hostname, and port from a URL.
 * Used for iframe security validation (comparing origins).
 *
 * Pattern breakdown:
 * - ^(https?:|file:)? - Optional protocol (http, https, or file)
 * - \/\/ - Required double slash
 * - ([^/:]+)? - Optional hostname (anything except / or :)
 * - (:(\d+))? - Optional port number
 */
const urlRegex = /^(https?:|file:)?\/\/([^/:]+)?(:(\d+))?/;

/**
 * Default ports for common protocols. Used to normalize origins by omitting
 * default ports (http://example.com:80 → http://example.com)
 */
const ports: any = { "http:": "80", "https:": "443" };

/**
 * URL Processing: Extract Origin
 * ───────────────────────────────
 * Converts a full URL into its origin (protocol + hostname + port), removing
 * the path, query, and fragment. This is used for iframe security validation.
 *
 * WHY THIS IS NEEDED:
 * When using postMessage with iframes, we need to validate the origin of
 * messages for security. The origin must match exactly, and should not include
 * default ports.
 *
 * Examples:
 * - "https://example.com/path?query=1" → "https://example.com"
 * - "http://localhost:8080/app" → "http://localhost:8080"
 * - "http://example.com:80/path" → "http://example.com" (port 80 is default)
 * - "file:///path/to/file.html" → "file://"
 *
 * How it works:
 * 1. Parse URL with regex to extract protocol, hostname, port
 * 2. Handle special case for file:// protocol
 * 3. Omit port if it's the default for the protocol
 * 4. Return normalized origin
 *
 * Security implications:
 * - Origin validation prevents malicious iframes from impersonating trusted ones
 * - Same-origin policy enforcement
 * - Must match exactly (including protocol and port)
 *
 * @param url The full URL to extract origin from
 * @returns The origin string (protocol + hostname + port) or null if invalid
 */
export function getOriginFromURL(url: string | null) {
  if (!url) return null;

  const regexResult = urlRegex.exec(url);
  if (!regexResult) return null;

  const [, protocol = "http:", hostname, , port] = regexResult;

  // If the protocol is file, return file://
  // (file URLs don't have hostnames)
  if (protocol === "file:") {
    return "file://";
  }

  // If the port is the default for the protocol, we don't want to add it to the origin string
  // This normalizes "http://example.com:80" to "http://example.com"
  const portSuffix = port && port !== ports[protocol] ? `:${port}` : "";
  return `${protocol}//${hostname}${portSuffix}`;
}

/**
 * Object Path Utilities: Get
 * ──────────────────────────
 * Safely retrieves a value from a nested object using a path string or array.
 * Returns a default value if the path doesn't exist.
 *
 * WHY THIS IS NEEDED:
 * When working with nested schemas (e.g., schema.math.add), we need to safely
 * access properties without throwing errors if intermediate keys don't exist.
 *
 * Examples:
 * const obj = { math: { add: fn, multiply: fn }, config: { timeout: 5000 } };
 *
 * get(obj, "math.add") → [Function]
 * get(obj, ["math", "add"]) → [Function]
 * get(obj, "math.subtract") → undefined
 * get(obj, "math.subtract", "default") → "default"
 * get(obj, "config.timeout") → 5000
 *
 * @param obj The object to retrieve value from
 * @param path Dot-notation string or array of keys (e.g., "a.b.c" or ["a", "b", "c"])
 * @param defaultValue Value to return if path doesn't exist
 * @returns The value at the path, or defaultValue if not found
 */
export function get(obj: any, path: string | Array<string | number>, defaultValue?: any): any {
  // Convert path to array of keys (["a", "b", "c"])
  const keys = Array.isArray(path) ? path : path.split(".").filter(Boolean);
  let result = obj;

  // Traverse the object following the path
  for (const key of keys) {
    result = result?.[key];
    if (result === undefined) {
      return defaultValue;
    }
  }

  return result;
}

/**
 * Object Path Utilities: Set
 * ──────────────────────────
 * Sets a value in a nested object using a path string or array. Creates
 * intermediate objects/arrays as needed.
 *
 * WHY THIS IS NEEDED:
 * When creating proxy functions for nested schemas (e.g., remote.math.add),
 * we need to build the object structure dynamically. This function handles
 * that, creating intermediate objects as needed.
 *
 * Examples:
 * const obj = {};
 * set(obj, "math.add", fn) → obj becomes { math: { add: fn } }
 * set(obj, ["math", "multiply"], fn) → obj becomes { math: { add: fn, multiply: fn } }
 * set(obj, "items.0.name", "foo") → obj becomes { items: [{ name: "foo" }] }
 *
 * How it works:
 * - Traverses the path, creating objects/arrays as needed
 * - If next key is a number, creates an array; otherwise creates an object
 * - Sets the final value at the end of the path
 *
 * @param obj The object to set value in (will be mutated)
 * @param path Dot-notation string or array of keys
 * @param value The value to set at the path
 * @returns The modified object
 */
export function set(obj: any, path: string | (string | number)[], value: any): any {
  if (!obj || typeof obj !== "object") return obj;

  // Convert path to array, converting numeric strings to numbers
  const pathArray = Array.isArray(path) ? path : path.split(".").map((key) => (key.match(/^\d+$/) ? Number(key) : key));

  let current = obj;

  for (let i = 0; i < pathArray.length; i++) {
    const key = pathArray[i];

    if (i === pathArray.length - 1) {
      // Last key in path - set the value
      current[key] = value;
    } else {
      // Intermediate key - ensure it exists
      if (!current[key] || typeof current[key] !== "object") {
        // Create array if next key is numeric, object otherwise
        current[key] = typeof pathArray[i + 1] === "number" ? [] : {};
      }
      current = current[key];
    }
  }

  return obj;
}

/**
 * ID Generation
 * ─────────────
 * Generates a random alphanumeric ID for uniquely identifying connections
 * and RPC calls.
 *
 * WHY THIS IS NEEDED:
 * - Connection IDs: Ensure messages are routed to the correct guest when
 *   multiple connections exist
 * - Call IDs: Match RPC requests with their responses when multiple calls
 *   are in-flight simultaneously
 *
 * How it works:
 * - Generates a random string of specified length
 * - Uses alphanumeric characters (A-Z, a-z, 0-9)
 * - Default length is 10 characters (62^10 ≈ 839 quadrillion possibilities)
 *
 * Example output:
 * - "aB3dE5fGhI"
 * - "Zx9Qw2Rt8Y"
 *
 * Note: This uses Math.random() which is not cryptographically secure.
 * For security-critical applications, use crypto.getRandomValues() instead.
 * However, for connection/call IDs, Math.random() is sufficient.
 *
 * @param length Number of characters in the ID (default: 10)
 * @returns A random alphanumeric ID
 */
export function generateId(length: number = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Node.js Worker Thread Support
 * ──────────────────────────────
 * In Node.js, worker threads communicate via a parentPort (from 'worker_threads'
 * module). We need to detect and store this at module load time.
 *
 * Why at module load time?
 * - parentPort only exists in Node.js worker thread context
 * - It's undefined in the main thread
 * - We check once at startup and store it for later use
 *
 * Try/catch reasoning:
 * - require('worker_threads') will throw if:
 *   1. We're not in Node.js (browser)
 *   2. We're in Node.js main thread (not a worker)
 * - We catch these errors and leave parentPort as null
 */
let parentPort: any = null;

if (isNodeEnv()) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const workerThreads = require("worker_threads");
    parentPort = workerThreads.parentPort; // Will be null if not in worker thread
  } catch (e) {
    // Not in worker thread context, or worker_threads not available
  }
}

/**
 * Message Passing: Get Target Host
 * ─────────────────────────────────
 * Automatically detects the appropriate message target based on the current
 * execution environment. This is used by guests to determine where to send
 * messages to reach the host.
 *
 * WHY THIS IS NEEDED:
 * Different environments have different targets:
 * - Node.js worker → parentPort (from worker_threads module)
 * - Web Worker → self (the global object in workers)
 * - iframe → window.parent (the parent window)
 *
 * This function abstracts away these differences so guest code can simply
 * call getTargetHost() without worrying about the environment.
 *
 * Examples:
 * // In a Web Worker:
 * const target = getTargetHost(); // Returns self
 * target.postMessage({ ... });
 *
 * // In an iframe:
 * const target = getTargetHost(); // Returns window.parent
 * target.postMessage({ ... }, "*");
 *
 * // In a Node.js worker thread:
 * const target = getTargetHost(); // Returns parentPort
 * target.postMessage({ ... });
 *
 * @returns The appropriate messaging target for the current environment
 * @throws Error if no valid target can be determined
 */
export function getTargetHost(): any {
  if (isNodeEnv()) {
    return parentPort;
  }

  if (isWorker()) {
    return self;
  }

  if (isIframe()) {
    return window.parent;
  }

  throw new Error("No valid target found for postMessage");
}

/**
 * Message Passing: Post Message to Target
 * ────────────────────────────────────────
 * Sends a message to a target, automatically handling environment-specific
 * differences in the postMessage API.
 *
 * THE PROBLEM:
 * Different environments have different postMessage signatures:
 *
 * Browser (window/iframe):
 * - window.postMessage(message, targetOrigin, [transfer])
 * - OR window.postMessage(message, { targetOrigin, transfer })
 *
 * Web Worker:
 * - worker.postMessage(message, [transfer])
 * - OR worker.postMessage(message, { transfer })
 *
 * Node.js Worker:
 * - parentPort.postMessage(message, { transfer: [...] })
 *
 * THE SOLUTION:
 * This function detects the environment and calls postMessage with the
 * correct signature.
 *
 * TRANSFERABLES:
 * Some objects (ArrayBuffer, MessagePort, ImageBitmap, etc.) can be
 * "transferred" rather than cloned. This is more efficient because:
 * - Transferring moves ownership without copying
 * - Original context loses access (prevents race conditions)
 * - Particularly important for large data (video, audio, images)
 *
 * Examples:
 * // Send to iframe:
 * postMessageToTarget(iframe.contentWindow, { action: "ping" }, "https://example.com");
 *
 * // Send to worker with transferable:
 * const buffer = new ArrayBuffer(1024);
 * postMessageToTarget(worker, { buffer }, undefined, [buffer]);
 *
 * // Send to Node.js worker:
 * postMessageToTarget(parentPort, { data: "hello" });
 *
 * @param target The target to send the message to (window, worker, or port)
 * @param message The message to send (must be structured-cloneable)
 * @param origin Optional origin for iframe communication (default: "*")
 * @param transferables Optional array of transferable objects
 * @throws Error if target is invalid or postMessage fails
 */
export function postMessageToTarget(
  target: Target,
  message: any,
  origin?: string,
  transferables?: Transferable[],
): void {
  if (!target) {
    throw new Error("PostBridge Error: No target specified for postMessage");
  }

  // Node.js Worker - uses parentPort.postMessage(msg, { transfer: [...] })
  if (isNodeEnv() && target === parentPort) {
    target.postMessage(message, { transfer: transferables });
    return;
  }

  // Web Worker - uses worker.postMessage(msg, { transfer: [...] })
  if (isWorker()) {
    target.postMessage(message, { transfer: transferables });
    return;
  }

  // iframe or window - uses window.postMessage(msg, { targetOrigin, transfer })
  if (target.postMessage) {
    target.postMessage(message, { targetOrigin: origin || "*", transfer: transferables });
    return;
  }

  throw new Error("PostBridge Error: Invalid target for postMessage");
}

/**
 * Type Guard: Is Node Worker
 * ──────────────────────────
 * TypeScript type guard to check if a guest/target is a Node.js Worker.
 * This helps TypeScript understand the type and enables type-safe operations.
 *
 * Why type guards?
 * - TypeScript can't automatically narrow union types
 * - Type guards tell TypeScript "if this function returns true, the type is X"
 * - Enables autocomplete and type checking for worker-specific methods
 *
 * @param guest The guest or target to check
 * @returns true if it's a Node.js Worker (type narrowed to NodeWorker)
 */
export function isNodeWorker(guest: Guest | Target): guest is NodeWorker {
  return parentPort !== null && guest === parentPort;
}

/**
 * Type Guard: Is Worker-Like
 * ──────────────────────────
 * TypeScript type guard to check if a guest is any kind of worker (Web or Node.js).
 *
 * Why check both?
 * - Node.js workers and Web Workers have similar but different APIs
 * - Both can be treated as "worker-like" for certain operations
 * - This guard includes both types in the WorkerLike union
 *
 * @param guest The guest to check
 * @returns true if it's a worker (type narrowed to WorkerLike)
 */
export function isWorkerLike(guest: Guest): guest is WorkerLike {
  return isNodeWorker(guest) || (typeof Worker !== "undefined" && guest instanceof Worker);
}

/**
 * Event Handling: Add Event Listener
 * ───────────────────────────────────
 * Adds an event listener to a target, handling different APIs across environments.
 *
 * THE PROBLEM:
 * - Web APIs use: target.addEventListener(event, handler)
 * - Node.js APIs use: target.on(event, handler)
 *
 * THE SOLUTION:
 * Detect the target type and use the appropriate method.
 *
 * Why this matters:
 * - Single unified API for event subscription
 * - Works across all environments
 * - Type-safe (TypeScript knows which API to use)
 *
 * Example usage:
 * addEventListener(worker, "message", (event) => {
 *   console.log("Received:", event.data);
 * });
 *
 * @param target The target to add listener to
 * @param event The event name (usually "message")
 * @param handler The event handler function
 */
export function addEventListener(target: Target, event: string, handler: EventListenerOrEventListenerObject) {
  if (isNodeWorker(target)) {
    // Node.js style: target.on(event, handler)
    target.on(event, handler);
  } else if ("addEventListener" in target) {
    // Web style: target.addEventListener(event, handler)
    target.addEventListener(event, handler);
  }
}

/**
 * Event Handling: Remove Event Listener
 * ──────────────────────────────────────
 * Removes an event listener from a target, handling different APIs across
 * environments.
 *
 * THE PROBLEM:
 * - Web APIs use: target.removeEventListener(event, handler)
 * - Node.js APIs use: target.off(event, handler)
 *
 * THE SOLUTION:
 * Detect the target type and use the appropriate method.
 *
 * Why this is important:
 * - Prevents memory leaks by properly cleaning up listeners
 * - Essential when closing connections
 * - Must use same handler reference that was added
 *
 * Example usage:
 * const handler = (event) => { ... };
 * addEventListener(worker, "message", handler);
 * // Later...
 * removeEventListener(worker, "message", handler);
 *
 * @param target The target to remove listener from
 * @param event The event name (usually "message")
 * @param handler The exact handler function that was added
 */
export function removeEventListener(target: Target, event: string, handler: EventListenerOrEventListenerObject) {
  if (isNodeWorker(target)) {
    // Node.js style: target.off(event, handler)
    target.off(event, handler);
  } else if ("removeEventListener" in target) {
    // Web style: target.removeEventListener(event, handler)
    target.removeEventListener(event, handler);
  }
}

/**
 * Event Data Normalization
 * ────────────────────────
 * Normalizes message event data across Web and Node.js environments.
 *
 * THE PROBLEM:
 * Different environments structure message events differently:
 *
 * Web (workers, iframes):
 * - Event is an object: { data: { ... }, source, origin, ... }
 * - Actual message is in event.data
 *
 * Node.js (worker threads):
 * - Event IS the message: { action: "...", ... }
 * - No wrapper, message is directly passed
 *
 * THE SOLUTION:
 * Try event.data first (Web), fall back to event itself (Node.js).
 *
 * Why this matters:
 * - Rest of codebase doesn't need to know about environment differences
 * - Single way to access message data
 * - Works correctly in all contexts
 *
 * Examples:
 * // Web environment:
 * const data = getEventData({ data: { action: "ping" }, origin: "..." });
 * // Returns: { action: "ping" }
 *
 * // Node.js environment:
 * const data = getEventData({ action: "ping", callID: "123" });
 * // Returns: { action: "ping", callID: "123" }
 *
 * @param event The message event
 * @returns The actual message data
 */
export function getEventData(event: any) {
  return event.data || event;
}
