# PostBridge

[![npm](https://badge.fury.io/js/postbridge.svg)](https://www.npmjs.com/package/postbridge)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/postbridge)

> Lightweight, bidirectional RPC for iframes, webworkers, and cross-tab communication.

## Installation

```bash
npm i postbridge
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

## License

[Fair Source License v0.9](LICENSE) - Free for up to 10 users per organization
