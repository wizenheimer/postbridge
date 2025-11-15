<div align="center">

<h1>PostBridge</h1>

<p>Type-safe RPC for cross-context communication</p>

<p>Make Web Workers, iframes, and browser tabs talk to each other like they're in the same room</p>

<p>
  <a href="#quick-start"><strong>Quick Start</strong></a> |
  <a href="#communication-patterns"><strong>Patterns</strong></a> |
  <a href="https://wizenheimer.github.io/postbridge"><strong>Documentation</strong></a> |
  <a href="./examples"><strong>Examples</strong></a>
</p>

</div>

![PostBridge Overview](media/banner.png)

---

PostBridge eliminates the complexity of `postMessage` by providing a natural, Promise-based API for communication between isolated JavaScript contexts—Web Workers, iframes, Node.js Worker Threads, and browser tabs. Write async/await function calls instead of wrestling with event listeners, message routing, and manual ID tracking.

## Installation

```bash
npm i postbridge
```

## Communication Patterns

PostBridge supports three main communication patterns:

### 1:1 Communication (Host/Guest)

Perfect for iframe ↔ parent and worker ↔ main thread communication.

```
┌─────────────┐                         ┌─────────────┐
│    Host     │ ←─────────────────────→ │    Guest    │
│ (Main Page) │    Bidirectional RPC    │ (iframe or  │
│             │                         │   worker)   │
└─────────────┘                         └─────────────┘
```

### Cross-Tab Broadcasting (1:N)

Broadcast state changes across all browser tabs using SharedWorkers.

```
            ┌─────────────────────────────────┐
            │      SharedWorker (Relay)       │
            └─────────────────────────────────┘
                     ↑       ↑       ↑
                     │       │       │
              ┌──────┘       │       └──────┐
              │              │              │
          ┌───↓───┐      ┌───↓───┐      ┌───↓───┐
          │ Tab 1 │      │ Tab 2 │      │ Tab 3 │
          │       │      │       │      │       │
          └───────┘      └───────┘      └───────┘
           Broadcast → All tabs see the update
```

### Direct Tab-to-Tab Messaging (1:1 Targeted)

Send messages to specific tabs for peer-to-peer communication.

```
            ┌─────────────────────────────────┐
            │      SharedWorker (Router)      │
            └─────────────────────────────────┘
                     ↑                  ↓
                     │                  │
              ┌──────┘                  └─────┐
              │                               │
          ┌───↓───┐                       ┌───↓───┐
          │ Tab 1 │ ── Direct Message ──→ │ Tab 2 │
          │       │     (Tab 2 only)      │       │
          └───────┘                       └───────┘
```

## Quick Start

**Host (parent page)**

```js
import { host } from "postbridge";

const iframe = document.getElementById("myIframe");
const api = { getData: () => ({ value: 42 }) };

const connection = await host.connect(iframe, api);
const result = await connection.remote.someMethod();
connection.close();
```

**Guest (iframe/worker)**

```js
import { guest } from "postbridge";

const api = { someMethod: () => "hello" };
const connection = await guest.connect(api);

const data = await connection.remote.getData();
connection.close();
```

**Bridge (cross-tab)**

```js
import { bridge } from "postbridge";

const schema = {
  updateCount: (count) => {
    state.count = count;
  },
};

const conn = await bridge.connect(schema);
await conn.remote.updateCount(42); // Broadcasts to all tabs
```

## Documentation

Run the interactive documentation locally:

```bash
npm run storybook
```

Or visit: [https://wizenheimer.github.io/postbridge](https://wizenheimer.github.io/postbridge)

## Examples

- `examples/counter-sync/` - Cross-tab counter
- `examples/multi-channel/` - Channel isolation
- `examples/tab-messaging/` - Direct messaging

---

## Why PostBridge?

### The Problem: Isolated JavaScript Contexts

Modern web applications run code in **isolated execution contexts** for security and performance:

- **Web Workers** execute CPU-intensive tasks without blocking the UI
- **iframes** sandbox untrusted third-party content
- **Shared Workers** enable cross-tab communication
- **Node.js Worker Threads** provide true parallel processing

But these contexts are **completely isolated** from each other. They can't share memory, can't call each other's functions directly, and can't even access each other's variables. This isolation is by design—it's what keeps your application secure and stable.

```
┌──────────────────────────┐
│     Main Thread          │
│  - Global scope          │
│  - window object         │
│  - DOM access            │
│  - Cannot share memory   │
└──────────────────────────┘
            ║
            ║ (isolated)
            ║
┌──────────────────────────┐
│      Web Worker          │
│  - Separate global scope │
│  - NO window object      │
│  - NO DOM access         │
│  - Cannot access parent  │
└──────────────────────────┘
```

### The Traditional Solution: postMessage

JavaScript provides `postMessage()` as the **only way** to communicate across these boundaries. But using it directly is painful:

```js
// Traditional postMessage approach
worker.postMessage({ action: "CALCULATE", id: "123", data: [1, 2, 3] });

worker.addEventListener("message", (event) => {
  if (event.data.action === "RESULT" && event.data.id === "123") {
    console.log("Result:", event.data.result);
  }
});
```

**What's wrong with this?**

1. **Boilerplate Hell** - Every message needs manual routing, ID generation, and response matching
2. **Callback Soup** - Nested event listeners make code unreadable
3. **No Type Safety** - Easy to mistype action strings or forget required fields
4. **Error Handling Chaos** - Errors don't propagate naturally; you must manually match error messages to calls
5. **Bidirectional = 2x Complexity** - If both sides need to call each other, you duplicate all this logic
6. **Testing Nightmares** - Mocking postMessage flows requires intricate setup

For a simple calculation, you write **dozens of lines** of message routing, ID tracking, and event handling. For complex applications with multiple workers and iframes? The complexity becomes unmanageable.

### Real-World Pain Points

#### Pain Point #1: Manual Request-Response Matching

```js
// You have to do this for EVERY function call:
const callbacks = new Map();

function callRemote(method, args) {
  const id = Math.random().toString();
  return new Promise((resolve, reject) => {
    callbacks.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
}

worker.addEventListener("message", (event) => {
  const callback = callbacks.get(event.data.id);
  if (callback) {
    if (event.data.error) {
      callback.reject(new Error(event.data.error));
    } else {
      callback.resolve(event.data.result);
    }
    callbacks.delete(event.data.id);
  }
});
```

This is **infrastructure code** you shouldn't have to write. It's repetitive, error-prone, and clutters your business logic.

#### Pain Point #2: Error Propagation

```js
// Worker throws an error
self.addEventListener("message", (event) => {
  try {
    const result = divide(event.data.a, event.data.b);
    self.postMessage({ id: event.data.id, result });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error.message });
  }
});

// Main thread has to check for errors manually
worker.postMessage({ id: "123", a: 10, b: 0 });
worker.addEventListener("message", (event) => {
  if (event.data.id === "123") {
    if (event.data.error) {
      // Error handling
      console.error("Error:", event.data.error);
    } else {
      // Success handling
      console.log("Result:", event.data.result);
    }
  }
});
```

Errors don't **feel** like errors. They're just messages with an `error` property. You lose stack traces, can't use try-catch naturally, and debugging becomes guesswork.

#### Pain Point #3: Multiple Connections

```js
// Managing multiple workers is exponentially worse
const worker1 = new Worker("worker1.js");
const worker2 = new Worker("worker2.js");
const iframe = document.getElementById("iframe");

// Now you need separate event listeners for each
worker1.addEventListener("message", (event) => {
  /* route worker1 messages */
});
worker2.addEventListener("message", (event) => {
  /* route worker2 messages */
});
window.addEventListener("message", (event) => {
  /* route iframe messages */
});

// And you must track which message came from where
// And handle origin validation for iframes
// And ensure message IDs don't collide across contexts
```

The complexity grows **geometrically** with each new connection.

#### Pain Point #4: Binary Data Transfer

```js
// Transferring large binary data requires special handling
const buffer = new ArrayBuffer(10 * 1024 * 1024); // 10MB

// Without transferables: Slow copy (memory doubled)
worker.postMessage({ buffer }); // Takes time, uses 20MB total

// With transferables: Fast but verbose
worker.postMessage({ buffer }, [buffer]); // buffer now unusable!
// And you must remember to include the transferables array
// And track which objects are transferable
```

Optimizing data transfer means **more boilerplate** and **easy-to-make mistakes** (forgetting to include transferables, or accidentally using a transferred buffer).

### The PostBridge Solution

PostBridge eliminates all this complexity with a **natural, function-call API**:

```js
// PostBridge approach
const connection = await host.connect(worker, {
  log: (msg) => console.log(msg),
});

const result = await connection.remote.calculate([1, 2, 3]);
```

**That's it.** No message routing. No ID generation. No manual error handling. Just call the function.

#### How It Works

Under the hood, PostBridge handles all the complexity:

```
Host                                    Guest
  │                                       │
  │ await remote.calculate([1,2,3])       │
  │                                       │
  │─── RPC_REQUEST ─────────────────────→ │
  │    { callID: 'abc',                   │
  │      method: 'calculate',             │
  │      args: [[1,2,3]] }                │
  │                                       │
  │                        Execute: calculate([1,2,3])
  │                        Result: 6
  │                                       │
  │←── RPC_RESOLVE ────────────────────── │
  │    { callID: 'abc',                   │
  │      result: 6 }                      │
  │                                       │
  │ Promise resolves with: 6              │
```

### How PostBridge Fixes Everything

| Traditional postMessage                          | PostBridge                             |
| ------------------------------------------------ | -------------------------------------- |
| Manual message routing & ID generation           | Automatic routing via JavaScript Proxy |
| Callback-based, nested event listeners           | Promise-based async/await              |
| No type safety                                   | Full TypeScript support                |
| Manual error propagation                         | Errors throw like local functions      |
| One-direction communication by default           | Bidirectional RPC built-in             |
| Transferables require verbose syntax             | Simple `withTransferable()` helper     |
| Origin validation for iframes is manual          | Automatic origin verification          |
| Different APIs for workers/iframes/SharedWorkers | Unified API for all contexts           |
| No built-in state synchronization                | Shared variables & state across tabs   |

### What You Get

**Natural Syntax** - Remote functions feel like local functions

```js
await remote.processData(data); // Just works
```

**Bidirectional By Default** - Both sides are equal peers

```js
// Worker can call main thread:
await remote.updateUI(progress);
```

**Type-Safe** - Full TypeScript support catches errors at compile time

```ts
interface WorkerAPI {
  process: (data: number[]) => Promise<number[]>;
}
const connection = await host.connect<{}, WorkerAPI>(worker, {});
```

**Error Handling That Makes Sense** - Use try-catch naturally

```js
try {
  await remote.riskyOperation();
} catch (error) {
  console.error(error.message); // Actual error from worker
}
```

**Performance Optimizations Built-In** - Transferables made simple

```js
await remote.process(withTransferable((t) => t(buffer)));
```

**Security First** - Automatic origin validation for iframes

```js
// PostBridge validates iframe.src origin automatically
const conn = await host.connect(iframe, schema);
```

**Multiple Patterns** - One library, three communication modes

- 1:1 for workers and iframes
- 1:N broadcasting across tabs
- 1:1 targeted messaging between specific tabs

**Shared State & Functions** - Synchronize state across contexts

```js
const schema = {
  // Shared variables - synchronized across all tabs
  currentUser: { name: "Alice", role: "admin" },
  theme: "dark",

  // Shared functions - callable from any tab
  updateTheme: (newTheme, remote) => {
    remote.theme = newTheme;
    applyTheme(newTheme);
  },
};
```

### Before & After

**Before: 50 lines of postMessage infrastructure**

```js
const pending = new Map();
const messageId = () => Math.random().toString();

worker.addEventListener("message", (event) => {
  const { id, type, result, error } = event.data;
  const callback = pending.get(id);
  if (!callback) return;

  if (type === "response") {
    if (error) callback.reject(new Error(error));
    else callback.resolve(result);
  }
  pending.delete(id);
});

function callWorker(method, args) {
  return new Promise((resolve, reject) => {
    const id = messageId();
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args, type: "request" });
  });
}
```

**After: 2 lines with PostBridge**

```js
const connection = await host.connect(worker, schema);
const result = await connection.remote.process(data);
```

### Why Not BroadcastChannel API?

You might wonder: "Why not just use BroadcastChannel for cross-tab communication?" While BroadcastChannel is great for simple broadcasts, it has significant limitations:

#### Problem #1: No Request-Response Pattern

BroadcastChannel is **broadcast-only**. There's no built-in way to send a message and wait for a response.

```js
// BroadcastChannel: Fire and forget
const channel = new BroadcastChannel("my-channel");
channel.postMessage({ action: "getData", id: 123 });

// How do you get the response? You have to build it yourself!
channel.addEventListener("message", (event) => {
  if (event.data.responseId === 123) {
    // Manual matching required
  }
});
```

#### Problem #2: Can't Target Specific Tabs

BroadcastChannel **always broadcasts** to all tabs. You can't send a message to just one specific tab.

```js
// BroadcastChannel: All tabs receive this
channel.postMessage({ data: "hello" });
// Tab 1 gets it, Tab 2 gets it, Tab 3 gets it...
// Even if you only wanted Tab 2 to receive it!

// PostBridge: Target specific tabs
await connection.remote(targetTabId).sendMessage("hello");
```

#### Problem #3: No RPC - Still Manual Message Routing

Like raw postMessage, you're still manually routing messages with action types:

```js
// BroadcastChannel: Manual routing
const channel = new BroadcastChannel("app");
channel.addEventListener("message", (event) => {
  if (event.data.action === "UPDATE_COUNT") {
    handleUpdateCount(event.data.count);
  } else if (event.data.action === "RESET") {
    handleReset();
  } else if (event.data.action === "GET_STATE") {
    // And now you need to broadcast back the response...
    channel.postMessage({
      action: "STATE_RESPONSE",
      requestId: event.data.id,
      state: getState(),
    });
  }
});

// PostBridge: Automatic routing
const conn = await bridge.connect({
  updateCount: (count) => handleUpdateCount(count),
  reset: () => handleReset(),
  getState: () => getState(),
});
await conn.remote.updateCount(42); // Just call it
```

#### Problem #4: No Error Propagation

Errors don't propagate back to the sender:

```js
// BroadcastChannel: Errors are invisible
channel.addEventListener("message", (event) => {
  if (event.data.action === "PROCESS") {
    try {
      processData(event.data.payload);
    } catch (error) {
      // How do you send this error back?
      // You have to manually broadcast an error message
      channel.postMessage({
        action: "ERROR",
        requestId: event.data.id,
        error: error.message,
      });
    }
  }
});

// PostBridge: Errors throw naturally
try {
  await conn.remote.processData(payload);
} catch (error) {
  console.error("Processing failed:", error.message);
}
```

#### Problem #5: No Type Safety

BroadcastChannel has no TypeScript support for message schemas:

```js
// BroadcastChannel: No type checking
channel.postMessage({ action: "UDPATE_COUNT", count: 42 });
// ^ Typo in "UDPATE" - won't be caught!

// PostBridge: Full TypeScript support
interface Schema {
  updateCount: (count: number) => void;
}
const conn = await bridge.connect<Schema>(schema);
await conn.remote.udpateCount(42); // TypeScript error!
```

#### Problem #6: Still Need Manual ID Generation

For request-response, you still need the same infrastructure as postMessage:

```js
// BroadcastChannel: Same complexity as postMessage
const pending = new Map();
const requestId = () => Math.random().toString();

function callRemote(action, data) {
  return new Promise((resolve, reject) => {
    const id = requestId();
    pending.set(id, { resolve, reject });
    channel.postMessage({ action, data, requestId: id });

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Timeout"));
      }
    }, 5000);
  });
}

channel.addEventListener("message", (event) => {
  if (event.data.responseId) {
    const callback = pending.get(event.data.responseId);
    if (callback) {
      callback.resolve(event.data.result);
      pending.delete(event.data.responseId);
    }
  }
});

// You're back to the same complexity!
```

#### Problem #7: No SharedWorker Support

BroadcastChannel works between same-origin tabs, but doesn't integrate with SharedWorkers for message routing. PostBridge uses SharedWorkers as a relay, enabling:

- Targeted 1:1 messaging between specific tabs
- Centralized state management
- Connection tracking (know which tabs are open)

```js
// BroadcastChannel: No tab tracking
// You don't know which tabs exist or their IDs

// PostBridge: Full tab awareness
const tabs = await conn.getConnectedTabs();
console.log("Connected tabs:", tabs); // ['tab-1', 'tab-2', 'tab-3']
await conn.remote(tabs[1]).sendPrivateMessage("Hello Tab 2 only!");
```

#### Problem #8: No Unified API

BroadcastChannel only works for cross-tab communication. For workers or iframes, you're back to postMessage:

```js
// Need different code for each context
const channel = new BroadcastChannel("app"); // For tabs
const worker = new Worker("worker.js"); // Different API
const iframe = document.getElementById("iframe"); // Yet another API

// PostBridge: One API for everything
const tabConn = await bridge.connect(schema);
const workerConn = await host.connect(worker, schema);
const iframeConn = await host.connect(iframe, schema);
// Same API, same patterns, same simplicity
```

### When to Use BroadcastChannel

BroadcastChannel is fine for:

- Simple, one-way announcements ("reload page", "user logged out")
- Broadcasting events without needing responses
- Very simple cross-tab coordination

But for anything involving:

- Request-response patterns
- Targeted messaging
- Function calls across contexts
- Type safety
- Error handling
- Or any RPC-style communication

**Use PostBridge.** It solves all these problems and provides a unified API across all JavaScript contexts.

### Who This Is For

PostBridge is perfect if you're building:

- **Performance-critical web apps** that need Web Workers for heavy computation
- **Plugin systems** with sandboxed iframes for third-party code
- **Collaborative tools** requiring real-time cross-tab synchronization
- **Data processing pipelines** that benefit from parallel worker pools
- **Desktop apps** using Node.js Worker Threads for background tasks

### The Bottom Line

Modern JavaScript's isolated contexts are **essential for security and performance**, but communicating across them shouldn't require a PhD in message passing protocols.

PostBridge gives you the **security and performance benefits** of isolated contexts with the **developer experience** of direct function calls.

Stop wrestling with postMessage. Start building features.

## License

[Fair Source License v0.9](LICENSE)
