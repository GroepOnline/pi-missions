# Pi-Missions Terminal UI Reference

> Complete overview of all terminal UI elements, commands, and visual components in Pi-Missions

---

## 🎨 UI Component Architecture

Pi-Missions uses multiple UI patterns within the Pi coding agent extension:

1. **Status Bar/Footer** - Persistent single-line status at bottom of terminal
2. **Notify Messages** - Temporary popup messages for feedback
3. **Text Widgets** - Multi-line text displays via `ctx.ui.setWidget()`
4. **Overlay Components** - Full-screen interactive TUI components via `ctx.ui.custom()`
5. **Keyboard Shortcuts** - Global hotkeys for common actions

---

## 📊 Status Bar / Footer

### Location
Persistent footer at bottom of Pi terminal

### Function
Shows compact mission status at all times

### Display Format
```
🎯 Mission Title [3/15 20%] — Active Feature Title
```

### Status Icons
- `🎯` - Active mission
- `⏸` - Paused mission
- `⚠️` - Budget limited
- `✅` - Complete mission

### Implementation
```typescript
// src/ui.ts:50-59
updateFooter(ctx, mission) → ctx.ui.setStatus("pi-mission", status)
```

### Example States
```
🎯 Build User Auth System [3/15 20%] — F003: Implement JWT tokens
⏸ Build User Auth System [3/15 20%] — F003: Implement JWT tokens
⚠️ Build User Auth System [12/15 80%] — F012: Add rate limiting
✅ Build User Auth System [15/15 100%]
```

---

## 🔔 Notify Messages

### Purpose
Temporary popup messages for user feedback and notifications

### Severity Levels
- `info` - Informational messages (blue/white)
- `warning` - Non-critical warnings (yellow)
- `error` - Critical errors (red)
- `success` - Success messages (green)

### Usage Pattern
```typescript
ctx.ui.notify(message, "info")
ctx.ui.notify(message, "warning")
ctx.ui.notify(message, "error")
ctx.ui.notify(message, "success")
```

### Example Messages
```
✅ Mission created with 3 milestones, 15 features (AI-generated)
⚠️ Mission token budget 80% used.
❌ Feature not found: F999
ℹ️ Loaded mission: Build User Auth System
```

---

## 🖥️ Full-Screen Mission Control Dashboard

### Activation
- Command: `/mission dashboard`
- Keyboard: `Ctrl+Shift+M`

### Type
Full-screen interactive overlay component

### Visual Structure
```
🎯 Mission Control — Mission Title
Progress: 3/15 features (20%)  |  Status: active  |  Tokens: 45,231

🔍 Filter: [typing...]
┌─────────────────────────────────────────────────────────────────┐
│ ➡️ F001 [P1] Feature Title [2/3 AC]                              │
│   M01: Feature description here 🔗F002                           │
│ ▸ F002 [P2] Another Feature [0/2 AC]                            │
│   M01: Another description                                       │
│ ⛔ F003 [P3] Blocked Feature [1/1 AC]                           │
│   M01: Blocked due to dependency 🔗F001 ↳ Waiting for F001      │
│ ✅ F004 [P1] Done Feature [3/3 AC]                              │
│   M01: Completed feature                                         │
└─────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────┐
  │  ──────────────────────────────────────────────────────    │
  │  📋 F001: Feature Title                                    │
  │  Status: active  |  Priority: P1  |  Milestone: M01       │
  │  📝 Feature description here (truncated at 80 chars)      │
  │  🔗 Dependencies: F002                                      │
  │  ✅ Acceptance criteria:                                   │
  │     ☐ AC001: User can login with email/password            │
  │     ☑ AC002: Password hashing works correctly              │
  │     ☐ AC003: Session management works → `npm test auth`     │
  │  ──────────────────────────────────────────────────────    │
  └────────────────────────────────────────────────────────────┘

Keys: ↑↓ navigate  |  Enter select  |  Esc close  |  Ctrl+U clear filter  |  Ctrl+W delete word  |  Type to filter  |  15 features
```

### Features

#### Type-to-Filter
- Type any character to filter features in real-time
- Filters by feature ID, title, or description
- Case-insensitive

#### Keyboard Navigation
- `↑/↓` - Navigate feature list
- `Enter` - Select feature (opens detail view)
- `Esc` - Close dashboard (clears filter first if active)
- `Ctrl+U` - Clear filter instantly
- `Ctrl+W` - Delete last word from filter

#### Feature List Icons
- `➡️` - Active feature
- `✅` - Done feature
- `⛔` - Blocked feature
- `❌` - Failed feature
- `•` - Pending feature

#### Feature Labels
```
➡️ F001 [P1] Feature Title [2/3 AC]   M01: Description 🔗F002
│   │    │    │           │           │    │          │
│   │    │    │           │           │    │          └─ Dependencies
│   │    │    │           │           │    └─ Milestone + description
│   │    │    │           │           └─ Acceptance criteria badge
│   │    │    │           └─ Feature title
│   │    │    └─ Priority badge
│   │    └─ Feature ID
│   └─ Status icon
```

#### Detail Panel
Shows expanded details for selected feature:
- Status, priority, milestone
- Description (truncated at 80 chars)
- Dependencies
- Acceptance criteria with verification status
- Bash commands for automated checks

### Implementation
```typescript
// src/dashboard.ts
missionControlOverlay(mission, onAction) → ctx.ui.custom(overlay, { overlay: true })
```

---

## 📋 Text-Based Dashboard Widget

### Activation
- Command: `/mission status`
- Auto-shown on certain events

### Type
Multi-line text widget via `ctx.ui.setWidget()`

### Visual Structure
```
  🎯 Build User Auth System
     ████████░░░░░░░░░░░ 3/15 features — 20%
     ID: mission-20240508123456-build-user-auth-syst | Status: active | Tokens: 45,231
  ─────────────────────────────────────────────────────────────────────────────

  ➡️ M01: Authentication Core
     ██████░░░░░░░░░░░ 2/5 — 40%
       ➡️ F001 [P1] Implement user registration [2/3 AC] 🔗F002
       ➡️ F002 [P1] Implement login system [1/2 AC]
       ⛔ F003 [P2] Add password hashing [1/1 AC] ↳ Waiting for crypto lib
       • F004 [P3] Add session management [0/2 AC]
       • F005 [P1] Add logout functionality [0/1 AC]

  • M02: User Profile Management
     ░░░░░░░░░░░░░░░░ 0/5 — 0%
       • F006 [P2] Create profile model [0/2 AC]
       • F007 [P2] Profile CRUD operations [0/3 AC]
       • F008 [P1] Profile image upload [0/2 AC] 🔗F006
       • F009 [P3] Profile privacy settings [0/2 AC] 🔗F007
       • F010 [P1] Profile deletion [0/1 AC]

  ✅ M00: Setup Phase
     ████████████████ 3/3 — 100%

  ─────────────────────────────────────────────────────────────────────────────
  Commands: /mission next | done | block | pause | resume | status | dashboard | metrics | export
```

### Features

#### Progress Bars
```
████████░░░░░░░░░░░  = 8/15 filled (53%)
███████████████░░░░  = 12/15 filled (80%)
░░░░░░░░░░░░░░░░░░░  = 0/15 filled (0%)
```

#### Milestone Collapsing
- Fully completed milestones are collapsed to single line:
```
✅ M00: Setup Phase — all 3 features done
```

#### Active Feature Expansion
- Active features show expanded details:
```
       ➡️ F001 [P1] Implement user registration [2/3 AC] 🔗F002
   📝 Create user registration endpoint with email validation
   ✅ Acceptance criteria:
      ☐ AC001: User can register with valid email
      ☑ AC002: Email validation works correctly
      ☐ AC003: Password requirements enforced
   🔗 Depends on: F002
   ⏱  Active 25min (max 30min)
   🔧 45 tool calls
```

### Status Icons
- `✅` - Complete/Done
- `➡️` - Active
- `⛔` - Blocked
- `❌` - Failed
- `•` - Pending

### Implementation
```typescript
// src/ui.ts:64-124
dashboardRows(mission) → ctx.ui.setWidget("pi-mission-dashboard", rows)
```

---

## 📈 Metrics Display

### Activation
- Command: `/mission metrics`

### Type
Multi-line text notification

### Visual Structure
```
📊 Mission Metrics Summary
========================================
Total Missions: 1,759
Completed Missions: 842
Success Rate: 47.9%
Average Tokens/Mission: 45,231
Average Features/Mission: 12.3
Avg Completion Time: 45.2 min
📁 Metrics exported to: /home/user/.pi/missions/metrics-export.json
```

### Features
- Shows aggregated statistics across all missions
- Exports detailed metrics to JSON file
- Includes success rate, token usage, completion time

### Implementation
```typescript
// src/commands.ts:226-259
handleMetrics() → ctx.ui.notify(summary, "info")
```

---

## 🔍 Status Text Display

### Activation
- Command: `/mission status` (compact version)

### Type
Multi-line text notification

### Visual Structure
```
🎯 Mission: Build User Auth System
ID: mission-20240508123456-build-user-auth-syst
Status: active
Progress: 3/15 (20%)
Active: F001 — Implement user registration

➡️ M01: Authentication Core [2/5]
  ➡️ F001: Implement user registration (active)
  ➡️ F002: Implement login system (active)
  ⛔ F003: Add password hashing (blocked) — Waiting for crypto lib
  • F004: Add session management (pending)
  • F005: Add logout functionality (pending)

• M02: User Profile Management [0/5]
  • F006: Create profile model (pending)
  • F007: Profile CRUD operations (pending)
  • F008: Profile image upload (pending)
  • F009: Profile privacy settings (pending)
  • F010: Profile deletion (pending)

✅ M00: Setup Phase [3/3]
  ✅ F000: Project setup (done)
  ✅ F001: Dependencies installed (done)
  ✅ F002: Database configured (done)
```

### Features
- Compact milestone/feature listing
- Shows active feature prominently
- Includes blocked reasons

### Implementation
```typescript
// src/ui.ts:126-149
statusText(mission) → ctx.ui.notify(text, "info")
```

---

## ⌨️ Keyboard Shortcuts

### Global Shortcuts

#### `Ctrl+Shift+M` - Open Mission Control Dashboard
- Opens full-screen interactive dashboard
- Same as `/mission dashboard` command
- Works from anywhere in Pi session

#### `Ctrl+Shift+D` - Mark Feature Done
- Marks current active feature as done
- Shows confirmation dialog in UI sessions
- Auto-verifies all acceptance criteria
- Captures evidence automatically
- Equivalent to `/mission done` with automatic evidence

### Shortcut Implementation
```typescript
// src/index.ts:74-99
pi.registerShortcut("ctrl+shift+m", {
  description: "Open Mission Control dashboard",
  handler: (ctx) => handleDashboard(ctx, runtime),
});

pi.registerShortcut("ctrl+shift+d", {
  description: "Mark current mission feature as done",
  handler: async (ctx) => {
    // Confirmation and completion logic
  },
});
```

---

## 📝 Command UI Patterns

### Commands with UI Selection

#### `/mission list`
Shows interactive selection dialog:
```
Load mission:
  mission-001 — Build User Auth System [3/15] active
  mission-002 — Create Payment Gateway [5/20] paused
  mission-003 - Deploy to Production [10/10] complete
```

#### `/mission edit <feature-id>`
Shows editor dialog for JSON editing:
```
Edit feature JSON:
{
  "id": "F001",
  "title": "Implement user registration",
  "description": "Create registration endpoint",
  ...
}
```

### Commands with Confirmation

#### `/mission done [evidence]`
- Shows confirmation: "Feature done? Mark 'F001: Implement user registration' as completed?"
- Waits for user confirmation before proceeding

#### Keyboard `Ctrl+Shift+D`
- Same confirmation flow as `/mission done`

---

## 🎯 Visual Design System

### Color Scheme (Pi TUI)
- Status icons use emoji for universal compatibility
- Progress bars use block characters (█░)
- Separators use em-dashes (─)
- No ANSI color codes (relies on terminal colors)

### Typography
- Monospace font (terminal default)
- Consistent spacing: 2-space indentation for hierarchy
- Truncation at 80 chars for descriptions
- Badge format: `[value]` for metadata

### Icon System
```
✅ = Done/Complete
➡️ = Active/In Progress
⛔ = Blocked
❌ = Failed
• = Pending/Default
⏸ = Paused
⚠️ = Warning/Budget Limited
🎯 = Mission/Target
📝 = Description/Notes
🔗 = Dependencies
⏱ = Time/Duration
🔧 = Tools/Technical
💡 = Suggestions/Tips
📊 = Metrics/Statistics
📁 = File/Export
```

### Progress Bar Format
```
[████████░░░░░░░░░░░] 8/15 (53%)
```
- 20 characters wide
- Filled: █ (block)
- Empty: ░ (light shade)
- Shows count and percentage

### Badge Format
```
[P1] = Priority 1
[2/3 AC] = 2 of 3 acceptance criteria done
[F001] = Feature ID
[M01] = Milestone ID
```

---

## 🔧 UI Helper Functions

### Progress Bar
```typescript
// src/ui.ts:8-12
progressBar(done, total, width = 20) → string
// Returns: "████████░░░░░░░░░░░"
```

### Milestone Progress Bar
```typescript
// src/ui.ts:14-17
milestoneProgressBar(milestone) → string
// Returns: "████████░░░░░░░░░░░ 2/5 — 40%"
```

### Feature Label
```typescript
// src/dashboard.ts:45-49
featureLabel(feature) → string
// Returns: "➡️ F001 [P1] Feature Title [2/3 AC]"
```

### Status Icon
```typescript
// src/dashboard.ts:41-43
statusIcon(status) → string
// Returns: "✅", "➡️", "⛔", "❌", or "•"
```

### Footer Update
```typescript
// src/ui.ts:50-59
updateFooter(ctx, mission) → void
// Updates persistent status bar
```

---

## 📱 Responsive Design

### Terminal Width Adaptation
- Dashboard overlay adapts to terminal width
- Progress bars scale to available space
- Text truncation at 80 chars for descriptions
- Detail panel wraps to terminal width

### Non-UI Sessions
- Commands fall back to text-only mode
- `/mission dashboard` → shows text status instead
- `/mission list` → shows plain list instead of selection
- Keyboard shortcuts disabled in non-UI sessions

---

## 🎨 UI Component Hierarchy

```
Pi Terminal
├─ Status Bar (persistent)
│  └─ Mission status footer
├─ Main Content Area
│  ├─ Text Widgets (temporary)
│  │  ├─ Dashboard widget
│  │  ├─ Status text
│  │  └─ Metrics display
│  └─ Overlay Components (full-screen)
│     └─ Mission Control dashboard
└─ Notify Messages (popups)
   ├─ Info messages
   ├─ Warning messages
   ├─ Error messages
   └─ Success messages
```

---

## 🚀 UI Performance

### Rendering
- Dashboard: ~50ms for 15 features
- Text widget: ~10ms for typical mission
- Status bar: ~1ms update
- Overlay: ~30ms initial render

### Optimization
- Milestone collapsing for completed items
- Lazy feature detail rendering
- Efficient string building
- Minimal DOM manipulation (Pi TUI handles this)

---

## 📊 UI Metrics Displayed

### Per Feature
- Status icon
- Priority badge
- Acceptance criteria progress
- Dependencies
- Time elapsed (for active features)
- Tool call count (for active features)
- Blocked reasons (for blocked features)

### Per Milestone
- Progress bar
- Feature count
- Percentage complete
- Status icon

### Per Mission
- Title and ID
- Overall progress bar
- Status icon
- Token usage
- Feature count
- Completion percentage

### Global Metrics
- Total missions
- Completed missions
- Success rate
- Average tokens per mission
- Average features per mission
- Average completion time

---

## 🎯 UI Best Practices Used

1. **Consistent Icon System** - Universal emoji for status
2. **Progress Visualization** - Visual progress bars at all levels
3. **Hierarchy** - Clear visual hierarchy with indentation
4. **Compact Information** - Badges for metadata, truncation for long text
5. **Keyboard-First** - Full keyboard navigation in dashboard
6. **Fallback Support** - Text-only mode for non-UI sessions
7. **Performance** - Efficient rendering for large missions
8. **Accessibility** - High contrast, no color-dependent information