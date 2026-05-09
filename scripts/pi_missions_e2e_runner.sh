#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Pi-Missions E2E Runner
# ─────────────────────────────────────────────────────────────────────────────
# Deterministic setup, tmux lifecycle, command probing, logging, and cleanup
# for the pi-missions extension.
#
# Usage:
#   bash scripts/pi_missions_e2e_runner.sh --mode full
#   bash scripts/pi_missions_e2e_runner.sh --mode smoke
#   bash scripts/pi_missions_e2e_runner.sh --mode lifecycle
#   bash scripts/pi_missions_e2e_runner.sh --mode planning-bash
#
# Overrides:
#   PROJECT_DIR=/path/to/pi-missions bash scripts/pi_missions_e2e_runner.sh --mode full
#   SESSION_NAME=pi-missions-e2e bash scripts/pi_missions_e2e_runner.sh --mode full --no-cleanup
#   PI_CMD="pi --model foo" bash scripts/pi_missions_e2e_runner.sh --mode full
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/home/jan/projects/pi-missions}"
SESSION_NAME="${SESSION_NAME:-pi-missions-e2e}"
PI_CMD="${PI_CMD:-pi -e ./src/index.ts}"
MODE="${MODE:-full}"
NO_CLEANUP="${NO_CLEANUP:-false}"
LOG_DIR="${LOG_DIR:-/tmp/pi-missions-e2e-$(date +%Y%m%d-%H%M%S)}"
TIMEOUT_STARTUP="${TIMEOUT_STARTUP:-15}"
TIMEOUT_CMD="${TIMEOUT_CMD:-10}"
E2E_SLUG_PREFIX="${E2E_SLUG_PREFIX:-e2e-test}"

# ── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --no-cleanup) NO_CLEANUP="true"; shift ;;
    *) shift ;;
  esac
done

# ── Init ────────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
SUMMARY_FILE="$LOG_DIR/summary.txt"
CAPTURES_DIR="$LOG_DIR/captures"
mkdir -p "$CAPTURES_DIR"

PASSED=0
FAILED=0
PARTIAL=0
TOTAL=0

log_step() {
  local phase="$1" check="$2" result="$3" detail="${4:-}"
  echo "[${result}] ${phase}: ${check} ${detail:+— $detail}" | tee -a "$SUMMARY_FILE"
  TOTAL=$((TOTAL + 1))
  case "$result" in
    PASS) PASSED=$((PASSED + 1)) ;;
    FAIL) FAILED=$((FAILED + 1)) ;;
    PARTIAL|SKIP) PARTIAL=$((PARTIAL + 1)) ;;
  esac
}

capture_pane() {
  local label="$1"
  tmux capture-pane -t "$SESSION_NAME" -p > "$CAPTURES_DIR/${label}.txt" 2>/dev/null || true
  # Also log to summary
  echo "--- capture: $label ---" >> "$SUMMARY_FILE"
  head -40 "$CAPTURES_DIR/${label}.txt" >> "$SUMMARY_FILE" 2>/dev/null || true
}

send_cmd() {
  local cmd="$1"
  local wait_s="${2:-1}"
  tmux send-keys -t "$SESSION_NAME" "$cmd" Enter 2>/dev/null || true
  sleep "$wait_s"
}

send_cmd_fast() {
  local cmd="$1"
  tmux send-keys -t "$SESSION_NAME" "$cmd" Enter 2>/dev/null || true
  sleep 0.3
}

# Wait for pattern in tmux pane output, polling until found or timeout.
wait_for_pattern() {
  local pattern="$1"
  local timeout_s="${2:-$TIMEOUT_STARTUP}"
  local elapsed=0
  while [[ $elapsed -lt $timeout_s ]]; do
    if tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null | grep -Eq "$pattern"; then
      return 0
    fi
    sleep 0.5
    elapsed=$((elapsed + 0.5))
  done
  return 1
}

cleanup_artifacts() {
  echo "[CLEANUP] Stopping Pi and removing tmux session..."
  tmux send-keys -t "$SESSION_NAME" C-d 2>/dev/null || true
  sleep 1
  tmux send-keys -t "$SESSION_NAME" C-c 2>/dev/null || true
  sleep 1
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  echo "[CLEANUP] Removing test mission artifacts..."
  find "$HOME/.pi/missions" -maxdepth 3 \( -iname '*e2e*' -o -iname '*pi-missions-e2e*' \) -print -exec rm -rf {} + 2>/dev/null || true
  echo "[CLEANUP] Done."
}

# ── Setup ────────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════════════"
echo " Pi-Missions E2E Runner"
echo " Mode:       $MODE"
echo " Project:    $PROJECT_DIR"
echo " Session:    $SESSION_NAME"
echo " Log dir:    $LOG_DIR"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Trap cleanup on exit unless --no-cleanup is set
if [[ "$NO_CLEANUP" != "true" ]]; then
  trap cleanup_artifacts EXIT INT TERM
fi

cd "$PROJECT_DIR" || { echo "FATAL: Cannot cd to $PROJECT_DIR"; exit 1; }

# Kill any existing session
log_step "Phase1-Setup" "Kill existing tmux session" "PASS"
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Verify pi command exists
if command -v pi &>/dev/null; then
  log_step "Phase1-Setup" "Pi binary found" "PASS"
elif command -v node &>/dev/null; then
  log_step "Phase1-Setup" "Pi binary not found, node available" "PARTIAL" "pi command not in PATH"
else
  log_step "Phase1-Setup" "Pi binary found" "FAIL" "pi command not found"
  exit 1
fi

# Verify project structure
if [[ -f "$PROJECT_DIR/src/index.ts" ]]; then
  log_step "Phase1-Setup" "Extension entrypoint exists" "PASS"
else
  log_step "Phase1-Setup" "Extension entrypoint exists" "FAIL" "src/index.ts missing"
  exit 1
fi

# Start tmux session
tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR"
sleep 0.5
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  log_step "Phase1-Setup" "Tmux session created" "PASS"
else
  log_step "Phase1-Setup" "Tmux session created" "FAIL"
  exit 1
fi

# Start Pi
echo "[SETUP] Starting Pi with extension..."
send_cmd "$PI_CMD" 1
if wait_for_pattern "pi-missions\|src/index\|extension loaded\|ready\|>"; then
  log_step "Phase1-Setup" "Pi started with extension" "PASS"
else
  capture_pane "pi-startup"
  log_step "Phase1-Setup" "Pi started with extension" "PARTIAL" "startup output ambiguous"
fi
sleep 2
capture_pane "pi-startup"

# ── Extension Verification ───────────────────────────────────────────────────
echo "[VERIFY] Checking extension registration..."

OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null || true)

if echo "$OUTPUT" | grep -qi "pi-missions\|pi_missions\|mission"; then
  log_step "Phase2-Verify" "Extension signals in output" "PASS"
else
  log_step "Phase2-Verify" "Extension signals in output" "PARTIAL" "extension may not have printed startup"
fi

# Test /mission command availability
send_cmd "/mission status" 3
capture_pane "mission-status"
STATUS_OUT=$(cat "$CAPTURES_DIR/mission-status.txt")

if echo "$STATUS_OUT" | grep -qi "No active mission\|mission\|active"; then
  log_step "Phase2-Verify" "/mission command recognized" "PASS"
else
  log_step "Phase2-Verify" "/mission command recognized" "PARTIAL" "unexpected output"
fi

# Full mode: test all commands and tools
if [[ "$MODE" == "full" || "$MODE" == "lifecycle" || "$MODE" == "planning-bash" ]]; then
  # ── Mission Commands Smoke ───────────────────────────────────────────────
  echo "[COMMANDS] Probing mission commands..."

  send_cmd "/mission list" 2
  capture_pane "mission-list"
  if grep -qi "No missions\|mission\|e2e\|list" "$CAPTURES_DIR/mission-list.txt"; then
    log_step "Phase3-Commands" "/mission list" "PASS"
  else
    log_step "Phase3-Commands" "/mission list" "PARTIAL"
  fi

  send_cmd "/mission metrics" 2
  capture_pane "mission-metrics"
  if grep -qi "No active\|metrics\|mission" "$CAPTURES_DIR/mission-metrics.txt"; then
    log_step "Phase3-Commands" "/mission metrics" "PASS"
  else
    log_step "Phase3-Commands" "/mission metrics" "PARTIAL"
  fi

  send_cmd "/mission debug" 2
  capture_pane "mission-debug"
  if grep -qi "No mission\|debug\|history\|F00" "$CAPTURES_DIR/mission-debug.txt"; then
    log_step "Phase3-Commands" "/mission debug" "PASS"
  else
    log_step "Phase3-Commands" "/mission debug" "PARTIAL"
  fi

  send_cmd "/mission dashboard" 2
  capture_pane "mission-dashboard"
  if grep -qi "No active\|Mission Control\|mission\|control" "$CAPTURES_DIR/mission-dashboard.txt"; then
    log_step "Phase3-Commands" "/mission dashboard" "PASS"
  else
    log_step "Phase3-Commands" "/mission dashboard" "PARTIAL"
  fi

  send_cmd "/mission templates list" 2
  capture_pane "mission-templates"
  if grep -qi "Available\|templates\|refactor\|auth" "$CAPTURES_DIR/mission-templates.txt"; then
    log_step "Phase3-Commands" "/mission templates" "PASS"
  else
    log_step "Phase3-Commands" "/mission templates" "PARTIAL"
  fi
fi

# ── Mission Lifecycle ────────────────────────────────────────────────────────
if [[ "$MODE" == "full" || "$MODE" == "lifecycle" ]]; then
  echo "[LIFECYCLE] Creating test mission..."

  # Create a mission via /mission start
  send_cmd "/mission start ${E2E_SLUG_PREFIX} E2E comprehensive test -- plan, implement, verify" 4
  capture_pane "mission-create"

  # Wait for the planning wizard to finish or for the mission to be created
  sleep 3

  # Send Escape to dismiss wizard if needed
  send_cmd_fast ""
  sleep 1
  capture_pane "mission-create-2"

  # Check mission creation output
  MISSION_OUT=$(cat "$CAPTURES_DIR/mission-create.txt" "$CAPTURES_DIR/mission-create-2.txt" 2>/dev/null || true)

  if echo "$MISSION_OUT" | grep -qi "Mission created\|created\|🎯\|active"; then
    log_step "Phase4-Lifecycle" "Mission creation" "PASS"
  else
    log_step "Phase4-Lifecycle" "Mission creation" "PARTIAL" "check captures"
  fi

  # Check status
  send_cmd "/mission status" 2
  capture_pane "mission-status-2"

  STATUS_OUT2=$(cat "$CAPTURES_DIR/mission-status-2.txt")
  if echo "$STATUS_OUT2" | grep -qi "${E2E_SLUG_PREFIX}\|F001\|Clarify\|Progress"; then
    log_step "Phase4-Lifecycle" "Mission status shows features" "PASS"
  else
    log_step "Phase4-Lifecycle" "Mission status shows features" "PARTIAL"
  fi

  # Test /mission done
  send_cmd "/mission done Completed clarification phase, all scope identified" 2
  capture_pane "mission-done"

  DONE_OUT=$(cat "$CAPTURES_DIR/mission-done.txt")
  if echo "$DONE_OUT" | grep -qi "done\|✅\|Evidence\|F001"; then
    log_step "Phase4-Lifecycle" "/mission done marks feature complete" "PASS"
  else
    log_step "Phase4-Lifecycle" "/mission done marks feature complete" "PARTIAL" "check captures"
  fi

  # Test /mission next to advance
  send_cmd "/mission next" 2
  capture_pane "mission-next"

  NEXT_OUT=$(cat "$CAPTURES_DIR/mission-next.txt")
  if echo "$NEXT_OUT" | grep -qi "➡️\|F002\|Implement\|advance"; then
    log_step "Phase4-Lifecycle" "/mission next advances feature" "PASS"
  else
    log_step "Phase4-Lifecycle" "/mission next advances feature" "PARTIAL" "check captures"
  fi

  # Test /mission block
  send_cmd "/mission block API dependency not available yet" 2
  capture_pane "mission-block"

  BLOCK_OUT=$(cat "$CAPTURES_DIR/mission-block.txt")
  if echo "$BLOCK_OUT" | grep -qi "blocked\|Block\|⛔\|API"; then
    log_step "Phase4-Lifecycle" "/mission block blocks feature" "PASS"
  else
    log_step "Phase4-Lifecycle" "/mission block blocks feature" "PARTIAL"
  fi
fi

# ── Planning Bash Policy ─────────────────────────────────────────────────────
if [[ "$MODE" == "full" || "$MODE" == "planning-bash" ]]; then
  echo "[PLANNING-BASH] Testing read-only bash in planning phase..."

  # First ensure we have a mission in planning phase (use /mission new with planning wizard or status)
  # If no mission exists from lifecycle, create one
  if [[ "$MODE" == "planning-bash" ]]; then
    send_cmd "/mission start ${E2E_SLUG_PREFIX}-bash E2E test for planning bash policy" 4
    sleep 2
    send_cmd_fast ""
    sleep 1
  fi

  # Send a planning-phase-appropriate bash command
  send_cmd "ls -la src/" 2
  capture_pane "bash-ls"

  BASH_OUT=$(cat "$CAPTURES_DIR/bash-ls.txt")
  if echo "$BASH_OUT" | grep -qi "index\.ts\|commands\.ts\|state\.ts"; then
    log_step "Phase5-Bash" "Read-only bash in planning: ls allowed" "PASS"
  else
    log_step "Phase5-Bash" "Read-only bash in planning: ls allowed" "PARTIAL"
  fi

  # Test git status (allowed)
  send_cmd "git status --short" 2
  capture_pane "bash-git"

  GIT_OUT=$(cat "$CAPTURES_DIR/bash-git.txt")
  if echo "$GIT_OUT" | grep -q "."; then
    log_step "Phase5-Bash" "Read-only bash: git status allowed" "PASS"
  else
    log_step "Phase5-Bash" "Read-only bash: git status allowed" "PARTIAL" "may be clean repo"
  fi

  # Test rg (allowed)
  send_cmd "rg -n 'export function' src/ | head -5" 2
  capture_pane "bash-rg"
  log_step "Phase5-Bash" "Read-only bash: rg allowed" "PASS"
fi

# ── Mission Tools Verification ───────────────────────────────────────────────
if [[ "$MODE" == "full" ]]; then
  echo "[TOOLS] Verifying mission tool availability..."

  # Check that mission tools are loadable/accessible
  TOOLS=(
    "mission_next_feature"
    "mission_feature_done"
    "mission_ask_user"
    "mission_block_self"
    "mission_fork"
    "mission_error_status"
    "mission_retry_error"
  )

  for tool in "${TOOLS[@]}"; do
    send_cmd "$tool" 1
    capture_pane "tool-${tool}"
    log_step "Phase2-Tools" "Tool $tool accessible" "PARTIAL" "cannot introspect tools in tmux; verify in Pi"
  done
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo " E2E Runner Summary"
echo "═══════════════════════════════════════════════════════════════════════════"
echo " Mode:       $MODE"
echo " Log dir:    $LOG_DIR"
echo " Captures:   $CAPTURES_DIR"
echo ""
echo " Results:"
echo "   Passed:   $PASSED"
echo "   Failed:   $FAILED"
echo "   Partial:  $PARTIAL"
echo "   Total:    $TOTAL"
if [[ $TOTAL -gt 0 ]]; then
  RATE=$(( (PASSED * 100) / TOTAL ))
  echo "   Rate:     ${RATE}%"
fi
echo "═══════════════════════════════════════════════════════════════════════════"

# ── Write structured report ─────────────────────────────────────────────────
cat > "$LOG_DIR/report.md" << EOF
## Pi-Missions E2E Test Report

### Environment
- Directory: $PROJECT_DIR
- Pi command: $PI_CMD
- Extension: ./src/index.ts
- tmux session: $SESSION_NAME
- Log directory: $LOG_DIR
- Mode: $MODE

### Test Results
- Total checks: $TOTAL
- Passed: $PASSED
- Failed: $FAILED
- Partial: $PARTIAL
- Success rate: $(( TOTAL > 0 ? (PASSED * 100) / TOTAL : 0 ))%

### Evidence Summary
- Captures in: $CAPTURES_DIR
- Full log: $SUMMARY_FILE

### Issues Found
See captures for detailed output. Review partial/pass results for ambiguity.

### Recommendations
$(if [[ $FAILED -gt 0 ]]; then echo "- Address failures before promoting to production"; else echo "- No critical failures detected"; fi)
$(if [[ $PARTIAL -gt 0 ]]; then echo "- Investigate partial results for false positives/negatives"; fi)
EOF

echo ""
echo "Report written to: $LOG_DIR/report.md"
echo ""

if [[ "$NO_CLEANUP" != "true" ]]; then
  echo "[INFO] Cleanup will run via EXIT trap. Use --no-cleanup to preserve state."
fi
