# GitHub Copilot & Coding Agent Instructions

## Project Overview
**ProfitHub Expert** is an advanced full-stack trading bot and quantitative analytics platform built on top of Deriv's Trading Bot Template. It features custom quantitative trading bots (XML bots), RSBuild frontend bundling, a Vercel serverless backend API, and real-time Deriv WebSocket integrations.

## Core Architecture
- **Frontend Framework**: React 18, MobX, TypeScript, SCSS modules.
- **Bundler**: `@rsbuild/core` (Rspack-based) with custom Sass loader plugins and SmartCharts Champion chunking.
- **Backend / API**: Express-compatible Node.js HTTP server for local development (`scripts/server.js`) and Vercel Serverless Functions (`api/*.js`).
- **Trading Engine**: Deriv Bot Skeleton (`src/external/bot-skeleton`) using Blockly and JS-Interpreter.
- **Charts**: SmartCharts Champion (`@deriv-com/smartcharts-champion`) with Flutter chart adapter support.

## Key Rules & Guidelines
1. **Never Break Custom Features During Upstream Syncs**:
   - Custom pages (`Digit Cracker`, `Free Bots`, `Elite Pro`, `Admin Panel`, `Speed Toggle`) must remain intact when syncing with `deriv-com/trading-bot-template`.
   - Brand assets and manifest configurations reside in `brand.config.json` and `public/xml-uploads/bots.json`.
2. **Account Switching & Header Icons**:
   - Always respect `isVirtual` when rendering account coins: virtual accounts use `CurrencyDemoIcon` (`CurrencyIcon isVirtual={true}`), and real accounts use their respective currency icon.
3. **Build & Deployment**:
   - Production builds run via `npm run build` (`scripts/generate-manifest.js` -> `rsbuild build` -> `scripts/copy-assets.js`).
   - The output directory is `dist/`. All non-API routes are rewritten to `/index.html` via `vercel.json`.
   - Vercel automatically deploys commits pushed to branch `main`.
