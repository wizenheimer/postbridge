# Bridge Example

A minimal black and white example demonstrating cross-tab synchronization with Bridge.

**Pattern Used:** Single Source of Truth

- Caller computes new value and broadcasts it
- Avoids multi-writer race conditions with increment/decrement
- See: [Troubleshooting Multi-Writer Issues](../docs/guides/troubleshooting-multi-writer.md)

## Quick Start

1. **Build the library:**

   ```bash
   npm run build
   ```

2. **Serve the example:**

   ```bash
   npx serve .
   ```

3. **Open in browser:**
   - Navigate to `http://localhost:3000/examples/counter-sync/`
   - Open the same URL in multiple tabs
   - Click buttons in any tab and watch them sync!

## What It Demonstrates

- Cross-tab state synchronization
- "No echo" behavior (sender doesn't receive own broadcasts)
- Schema functions as automatic handlers (no separate listeners needed)
- Clean black and white UI
- Real-time activity log

## Features

### Counter Sync

- Increment/decrement/reset buttons
- Updates happen in ALL tabs simultaneously
- Each tab executes the function locally

### Activity Log

- Shows local actions (outgoing →)
- Shows broadcasts from other tabs (incoming ←)
- Displays tab IDs for identification
- Timestamps on all events

### Status Indicator

- **[CONNECTING]** - Initializing
- **[CONNECTED]** - Ready to sync
- **[ERROR]** - Something went wrong

## Browser Support

This example requires SharedWorker support:

- Chrome/Edge
- Firefox
- Safari

## Code Structure

```
examples/counter-sync/
├── index.html          # Clean HTML structure
├── style.css           # Black & white styling
├── app.js              # Bridge logic
└── README.md           # This file
```

### File Breakdown

**index.html** - Clean semantic HTML

- Status indicator
- Counter display
- Control buttons
- Activity log

**style.css** - Minimal black & white design

- No colors (only black, white, grays)
- Border-based UI
- Monospace fonts
- Responsive layout

**app.js** - Bridge implementation

- Schema definition
- Connection setup
- Schema functions that execute automatically
- UI updates
- Activity logging

## Try It Out

1. Open in **Tab 1**, click increment
2. Open in **Tab 2**, see counter update
3. Click decrement in **Tab 2**
4. Watch **Tab 1** update automatically
5. Open **Tab 3**, reset counter
6. All tabs now show 0

## Minimal Code Example

```javascript
import { bridge } from "../lib/postbridge.js";

// Define schema
const schema = {
  increment: () => {
    counter++;
    return counter;
  },
};

// Connect (provide workerURL when not using a bundler)
const conn = await bridge.connect(schema, {
  workerURL: "/lib/bridge-worker.js",
});

// Broadcast to other tabs
await conn.remote.increment();
```

**Note:** When using Bridge without a bundler (like in this example), you must provide the `workerURL` option pointing to the worker file location.

## Troubleshooting

**Error: SharedWorker not supported**

- Use Chrome, Firefox, or Edge
- Safari doesn't support SharedWorkers

**Worker not loading**

- Run `npm run build` first
- Make sure you're serving from the project root
- Check browser console for errors

**Tabs not syncing**

- Verify all tabs are from the same origin
- Check that the worker file is loading (Network tab)
- Look for errors in the SharedWorker console

## Next Steps

- Try modifying the schema to add new methods
- Add more complex state (user data, theme, etc.)
- Experiment with different schema function patterns
- Check the logs to understand the message flow

## Learn More

- [Bridge Guide](../docs/guides/bridge.md)
- [Deployment Guide](../docs/guides/bridge-deployment.md)
- [API Reference](../docs/api-reference/)
