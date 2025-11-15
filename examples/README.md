# PostBridge Examples

This folder contains interactive examples demonstrating PostBridge's features. All examples use a minimal black and white design to keep focus on functionality.

## Available Examples

### 1. Counter Sync (`counter-sync/`)

**What it demonstrates:** Basic cross-tab state synchronization

A simple counter that stays synchronized across all browser tabs. Shows the fundamental broadcast pattern where one tab's action updates all tabs.

**Key features:**
- Cross-tab broadcasting
- Single source of truth pattern
- No echo behavior (sender doesn't receive own broadcasts)
- Real-time activity log

[View Example →](./counter-sync/)

### 2. Multi-Channel (`multi-channel/`)

**What it demonstrates:** Channel-based isolation

Two independent counter applications running in the same page on different channels. Shows how channels create isolated state spaces within a single SharedWorker.

**Key features:**
- Channel isolation
- Multiple independent state spaces
- Same SharedWorker, different channels
- No cross-channel interference

[View Example →](./multi-channel/)

### 3. Tab Messaging (`tab-messaging/`)

**What it demonstrates:** Direct tab-to-tab communication

Send messages to specific tabs or broadcast to all tabs. Shows both 1:1 targeted messaging and 1:N broadcasting patterns.

**Key features:**
- Tab discovery with `getConnectedTabs()`
- Direct messaging to specific tabs
- Broadcasting to all tabs
- Message filtering by recipient

[View Example →](./tab-messaging/)

## Running the Examples

### Prerequisites

1. Build the library first:
   ```bash
   npm run build
   ```

2. Serve the project root:
   ```bash
   npx serve .
   ```

3. Open any example in your browser:
   - Counter Sync: http://localhost:3000/examples/counter-sync/
   - Multi-Channel: http://localhost:3000/examples/multi-channel/
   - Tab Messaging: http://localhost:3000/examples/tab-messaging/

### Testing Multi-Tab Behavior

1. Open the example URL in your browser
2. Duplicate the tab (Cmd/Ctrl + Shift + T or right-click → Duplicate)
3. Open 3-4 tabs with the same URL
4. Interact with controls in any tab
5. Watch all tabs update in real-time

## Browser Support

All examples require SharedWorker support:
- Chrome/Edge
- Firefox
- Safari (no SharedWorker support)

## Troubleshooting

### Worker Not Loading
- Make sure you've run `npm run build` first
- Check that you're serving from the project root
- Verify `lib/postbridge.js` and `lib/bridge-worker.js` exist

### Tabs Not Syncing
- All tabs must be from the same origin
- Check browser console for errors
- Open DevTools → Application → SharedWorkers to debug

### State Out of Sync
- This is expected with multi-writer patterns
- See the counter-sync example's README for "Single Source of Truth" pattern
- Check out [Understanding Shared State](../stories/Guides/UnderstandingSharedState.mdx) in the docs

## Learn More

For detailed documentation:
- Run `npm run storybook` to browse full documentation
- Check out the [PostBridge Guide](../stories/Guides/Bridge.mdx)
- Read about [Shared State Patterns](../stories/Guides/SharedStatePatterns.mdx)

