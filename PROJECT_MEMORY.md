# Project Memory & Persistent Context

## Core User Preferences & Directives

1. **User Role**: Vibe Coder (communicates naturally in simple English).
2. **AI Role**: Lead Senior Developer (takes full technical ownership, handles architecture, edge cases, tests builds, pushes to GitHub, explains simply).
3. **Never Reset Context**: Build incrementally on top of established patterns without starting over or discarding prior features.

## Master System Knowledge Base

### 1. Speed / Fast Mode

- **Header Speed Switch**:
    - Desktop: Toggle switch labeled `⚡ Fast`.
    - Mobile: Dedicated `⚡` speed icon button.
- **Blockly Purchase Block**:
    - Direct checkbox on the block: `Purchase [ CONTRACT_TYPE ▼ ] ⚡ Fast: [ ☑ ]`.
    - Generates `Bot.purchase('TYPE', isFast)` to control zero-latency execution per block.
- **Run Panel Card**: Keep clean in original dimensions and layout.
- **Trade Engine Speed & 2-Tick Span**:
    - Plain Indices: Trade once every 2.0s tick without skipping.
    - 1s Indices (`1HZ...`): Trade once every 1.0s tick without skipping.
    - Direct buy parameters used in Fast mode to eliminate proposal wait times (0ms round-trip latency).
    - Immediate Buy Dispatch (Zero-Skip Breakthrough): In Fast Mode, as soon as a trade concludes and `Trade Again` triggers, `watchBefore` instantly resolves and dispatches the next buy order over WebSocket before the next tick occurs. Deriv receives the buy order ahead of time and locks in the **exact next incoming tick as the entry spot**, eliminating the 1-2 tick gap between consecutive trades.
    - Epoch Gating Removed: Eliminated `lastPurchasedTickEpoch` timestamp comparison in `Purchase.js` that was blocking immediate back-to-back purchases.
    - **2-Tick Contract Span (Fast Mode Only)**: In Fast Mode, contract cycle span is reduced from 3 ticks down to 2 ticks by settling immediately at Tick 2 upon `is_expired: 1` or `status !== 'open'`. When Fast Mode is disabled (Normal Mode), the engine maintains standard 3-tick broker settlement waiting for Deriv's `is_sold: 1` packet.

### 2. Trade Settlement & Result Posting

- In Fast Mode, contracts settle instantly at Tick 2 upon conclusion (`is_expired: 1` or `status !== 'open'`); in Normal Mode, contracts settle via standard `is_sold: 1` (3 ticks).
- `handleContractSold` updates Journal, totals, and triggers `sell()`.
- Stream Cleanup (`forget`): Every completed contract immediately sends a `forget` command to Deriv to prevent accumulating hundreds of open WebSocket streams that throttle and pause the bot after 60+ trades.
- JS Interpreter Microtask Scheduling: `interpreter.js` loop schedules iterations asynchronously to allow full garbage collection and prevent call stack exhaustion on long bot sessions.
- Error Unfreezing & Immediate Clean Stop:
    - When stopping the bot or when an API error occurs (e.g., _"Your account balance is insufficient"_), the Run Panel immediately resets `is_running = false`, `has_open_contract = false`, and transitions directly to `contract_stages.NOT_RUNNING`.
    - The UI never gets stuck in _"Bot is stopping"_ or freezes on purchase errors.
- Win/Loss outcomes, profit/loss calculations, Journal logs, and Transactions table are broadcast immediately upon completion.
- Consecutive trading resumes instantly after each trade concludes.

### 3. Account Sandboxes

- `isDemoAccount`, `isRealAccount`, `isVirtualAccount`, and `isVirtual` registered in `JSInterpreter` sandbox scope, `BotInterface`, and on `window`.

### 4. Design & Typography Tokens

- Palette: 10 color tokens (`--color-text`, `--color-local-accent`, etc.).
- Dashboard Hierarchy:
    1. Top Status & Metric Chips (Strategies count, Market Radar, Deriv WebSocket).
    2. 4-Pillar Core Grid (`AI Smart Trader`, `Bot Builder IDE`, `24+ Free Bots`, `Market Radar & Signals`).
    3. Action Launchers Bar (`Launch AI Smart Trader` & `Import Strategy XML`).
    4. Institutional 2-Column Utility Section (`Deriv Verified Registration` & `VIP WhatsApp Community`).
    5. Saved Strategies Workspace Table.
- Theme: Clean, solid, opaque dark luxury cards (`#0c1222` / `#0f1422` with `#1a243a` borders, zero glassmorphism blur) highlighted with the multi-color neon spectrum ribbon palette.
- Font Stack: `Inter` across all 5 typography scale classes (`type-1` to `type-5`).
- Spacing: 10 scale steps (`space-1` to `space-10`).
- Shapes: 3 radius standards (`radius-1`: 8px, `radius-2`: 12px, `radius-3`: 999px).

### 5. Real-Time Balance Synchronization
- `api_base.ts`: Preserves `balance` and `transaction` subscriptions across bot lifecycle resets (removed destructive `unsubscribeAllSubscriptions`).
- Auto-reconnection: Subscribes to `streamsToSubscribe` (`balance`, `proposal_open_contract`, `website_status`) on socket open.
- Optimistic & Periodic Updates: Instant balance deduction on `buy`, instant balance increment on contract settlement in `trade-purchase.ts`, combined with a 10s background reconciliation heartbeat in `CoreStoreProvider.tsx`.

### 6. Cleaned Navigation Matrix (20 Core Tabs)
- DTrader iframe page, navigation tab, dashboard cards, and unused components removed.
- Direct **Manual Trading** module (`DBOT_TABS.MANUAL_TRADING`) mapped cleanly across `src/pages/main/main.tsx`, `tab-icons.tsx`, `cards.tsx`, and `topbar-trade-controller.tsx`.
- 1-to-1 sync maintained between `hash` array (0–19), `DBOT_TABS`, `TAB_IDS`, and `siteConfig`.
