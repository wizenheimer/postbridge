# Storybook Documentation

This directory contains all the documentation for postbridge and Bridge in Storybook format.

## Structure

### 📖 Introduction
- Welcome page and overview

### Getting Started (1 story)
- Quick Start

### 🎓 Fundamentals (4 stories)
- RPC Basics
- postMessage API
- JavaScript Contexts
- Security

### 🏗️ Architecture (4 stories)
- Overview
- Handshake Protocol
- Message Flow
- Connection Lifecycle

### 📖 Guides (15 stories)
- Web Workers
- iframes
- Node.js Workers
- Shared Workers
- **Bridge** (Cross-tab broadcasting)
- Transferables
- Bidirectional RPC
- Nested APIs
- Error Handling
- Multiple Connections
- Channel Isolation
- Shared State Patterns
- Troubleshooting Multi-Writer
- Understanding Shared State
- Bridge Deployment

### API Reference (4 stories)
- host API
- guest API
- Connection
- withTransferable

### 💡 Examples (7 stories)
- Workers (interactive)
- Iframes (interactive)
- Nested APIs (interactive)
- CodeSandbox (interactive)
- Bridge Example
- Data Pipeline
- Image Processing

## Total: 36 Stories

## Running Storybook

### Development
```bash
npm run storybook
```

Opens at `http://localhost:6006`

### Build Static Site
```bash
npm run build-storybook
```

Output directory: `storybook-static/`

## Conversion

All markdown documentation from `docs/` was automatically converted to MDX format using the conversion script:

```bash
node scripts/convert-docs-to-storybook.js
```

Each MDX file includes:
- Storybook Meta tags for proper navigation
- Original markdown content
- Proper syntax highlighting
- Interactive code examples

## Features

**Complete Documentation** - All 31 markdown files converted
**Interactive Examples** - 4 live React component examples
**Organized Navigation** - Logical story hierarchy
**Search** - Full-text search across all documentation
**Dark/Light Mode** - Automatic theme switching
**Mobile Responsive** - Works on all devices
**Code Syntax Highlighting** - Beautiful code blocks
**Table of Contents** - Auto-generated for each page
**GitHub Flavored Markdown** - Full GFM support including tables via `@storybook/addon-mdx-gfm`

