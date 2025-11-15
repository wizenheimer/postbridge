import type { Preview } from '@storybook/react';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: true,
    },
    options: {
      storySort: {
        order: [
          'Introduction',
          'Getting Started',
          ['Quick Start', 'Installation'],
          'Fundamentals',
          ['RPC Basics', 'postMessage API', 'JavaScript Contexts', 'Security'],
          'Architecture',
          ['Overview', 'Handshake', 'Message Flow', 'Lifecycle'],
          'Guides',
          [
            'Web Workers',
            'iframes',
            'Node.js Workers',
            'Shared Workers',
            'Bridge',
            'Transferables',
            'Bidirectional RPC',
            'Nested APIs',
            'Error Handling',
            'Multiple Connections',
            'Channel Isolation',
            'Shared State Patterns',
            'Troubleshooting Multi-Writer',
            'Understanding Shared State',
            'Bridge Deployment',
          ],
          'API Reference',
          ['host API', 'guest API', 'Connection', 'withTransferable', 'Types'],
          'Examples',
          ['Workers', 'iframes', 'Nested', 'Bridge', 'CodeSandbox'],
        ],
      },
    },
  },
};

export default preview;
