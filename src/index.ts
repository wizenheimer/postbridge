/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PostBridge  [main entry point]
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PostBridge is a lightweight, bidirectional RPC (Remote Procedure Call) library
 * for JavaScript that enables seamless communication between isolated contexts:
 * - Web Workers ↔ Main thread
 * - iframes ↔ Parent window
 * - Node.js Worker threads ↔ Main thread
 *
 * WHAT MAKES POSTBRIDGE SPECIAL:
 * ──────────────────────────
 * ✓ BIDIRECTIONAL: Both sides can call each other's functions
 * ✓ ASYNC BY DEFAULT: All RPC calls return Promises
 * ✓ TRANSFERABLES: Efficient binary data transfer
 * ✓ TYPE-SAFE: Full TypeScript support
 * ✓ CROSS-PLATFORM: Works in browsers and Node.js
 * ✓ NESTED APIs: Support for namespaced function calls
 * ✓ ZERO DEPENDENCIES: Lightweight and self-contained
 *
 * QUICK START EXAMPLE:
 * ───────────────────
 *
 * HOST (Main thread):
 * ```javascript
 * import { host } from 'postbridge';
 *
 * // Create a worker
 * const worker = new Worker('worker.js');
 *
 * // Connect with schema
 * const connection = await host.connect(worker, {
 *   logMessage: (msg) => console.log('Host:', msg),
 *   getConfig: () => ({ theme: 'dark', version: '1.0' })
 * });
 *
 * // Call worker methods
 * const result = await connection.remote.processData([1, 2, 3]);
 * console.log('Result:', result); // [2, 4, 6]
 *
 * // Cleanup when done
 * connection.close();
 * ```
 *
 * GUEST (Worker):
 * ```javascript
 * import { guest } from 'postbridge';
 *
 * // Connect with schema
 * const connection = await guest.connect({
 *   processData: (data) => data.map(x => x * 2)
 * });
 *
 * // Call host methods
 * const config = await connection.remote.getConfig();
 * console.log('Config:', config); // { theme: 'dark', version: '1.0' }
 * ```
 *
 * CORE CONCEPTS:
 * ─────────────
 *
 * 1. HOST vs GUEST:
 *    - Host: Parent context (main thread, parent window)
 *    - Guest: Child context (worker, iframe, child process)
 *
 * 2. SCHEMA:
 *    - Object containing functions to expose via RPC
 *    - Can include nested objects for namespaced APIs
 *    - Non-function properties are passed as configuration
 *
 * 3. CONNECTION:
 *    - Bidirectional communication channel
 *    - Provides `remote` object for calling other side's methods
 *    - Must be closed when done to prevent memory leaks
 *
 * 4. HANDSHAKE:
 *    - Automatic negotiation process
 *    - Exchanges schemas between host and guest
 *    - Establishes unique connectionID for routing
 *
 * ADVANCED FEATURES:
 * ─────────────────
 *
 * Transferable Objects:
 * ```javascript
 * import { withTransferable } from 'postbridge';
 *
 * // Transfer ArrayBuffer without copying
 * const buffer = new ArrayBuffer(1024);
 * const result = await remote.processBuffer(
 *   withTransferable(t => t(buffer))
 * );
 * // buffer is now detached (transferred to other side)
 * ```
 *
 * Nested APIs:
 * ```javascript
 * const connection = await host.connect(worker, {
 *   math: {
 *     add: (a, b) => a + b,
 *     multiply: (a, b) => a * b
 *   }
 * });
 *
 * // Call nested methods
 * await connection.remote.math.add(5, 3); // 8
 * ```
 *
 * Multiple Connections:
 * ```javascript
 * const worker1 = new Worker('worker1.js');
 * const worker2 = new Worker('worker2.js');
 * const conn1 = await host.connect(worker1, schema1);
 * const conn2 = await host.connect(worker2, schema2);
 * // Each connection is independent
 * ```
 *
 * EXPORTS:
 * ───────
 * - host: For connecting FROM parent context TO child
 * - guest: For connecting FROM child context TO parent
 * - withTransferable: For marking objects as transferable
 * - All types: Connection, Schema, GuestConnectOptions, etc.
 *
 * SEE ALSO:
 * ────────
 * - types.ts: Type definitions and RPC fundamentals
 * - host.ts: Host connection implementation
 * - guest.ts: Guest connection implementation
 * - rpc.ts: Core RPC mechanism
 * - helpers.ts: Cross-platform utilities
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import guest from "./guest";
import host from "./host";
import { withTransferable } from "./rpc";
import Bridge from "./bridge";

// Export main APIs
export { host, guest, withTransferable, Bridge as bridge };

// Export all types (Connection, Schema, etc.)
export * from "./types";
