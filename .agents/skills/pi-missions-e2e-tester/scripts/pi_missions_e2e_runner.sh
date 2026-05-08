#!/usr/bin/env bash
set -u

PROJECT_DIR="${PROJECT_DIR:-/home/jan/projects/pi-missions}"
SESSION_NAME="${SESSION_NAME:-pi-missions-e2e}"
PI_CMD="${PI_CMD:-pi -e ./src/index.ts}"
MODE="smoke"
CLEANUP="yes"
WAIT_START="${WAIT_START:-5}"
WAIT_CMD="${WAIT_CMD:-2}"
LOG_DIR="${LOG_DIR:-/tmp/pi-missions-e2e-$(date +%Y%m%d-%H%M%S)}"

usage() {
  cat <<USAGE
Usage: $0 [--mode smoke|full] [--no-cleanup]

Environment overrides:
  PROJECT_DIR   default: /home/jan/projects/pi-missions
  SESSION_NAME  default: pi-missions-e2e
  PI_CMD        default: pi -e ./src/index.ts
  LOG_DIR       default: /tmp/pi-missions-e2e-<timestamp>
  WAIT_START    default: 5
  WAIT_CMD      default: 2
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --no-cleanup)
      CLEANUP="no"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/summary.md"
RAW_LOG="$LOG_DIR/run.log"
: > "$RAW_LOG"

log() {
  printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$RAW_LOG"
}

capture() {
  name="$1"
  tmux capture-pane -t "$SESSION_NAME" -p > "$LOG_DIR/$name.txt" 2>>"$RAW_LOG" || true
}

send_line() {
  label="$1"
  text="$2"
  log "SEND $label: $text"
  tmux send-keys -t "$SESSION_NAME" "$text" Enter 2>>"$RAW_LOG" || return 1
  sleep "$WAIT_CMD"
  capture "$label"
}

send_key() {
  label="$1"
  key="$2"
  log "SEND_KEY $label: $key"
  tmux send-keys -t "$SESSION_NAME" "$key" 2>>"$RAW_LOG" || return 1
  sleep "$WAIT_CMD"
  capture "$label"
}

check_contains() {
  file="$1"
  pattern="$2"
  if grep -Eiq "$pattern" "$file" 2>/dev/null; then
    printf '[x] %s\n' "$3" >> "$SUMMARY"
    return 0
  fi
  printf '[ ] %s\n' "$3" >> "$SUMMARY"
  return 1
}

cleanup() {
  log "Cleanup started"
  tmux send-keys -t "$SESSION_NAME" C-d 2>>"$RAW_LOG" || true
  sleep 1
  tmux kill-session -t "$SESSION_NAME" 2>>"$RAW_LOG" || true
  if [ "$CLEANUP" = "yes" ] && [ -d "$HOME/.pi/missions" ]; then
    find "$HOME/.pi/missions" -maxdepth 3 \( -iname '*e2e*' -o -iname '*pi-missions-e2e*' \) -print -exec rm -rf {} + > "$LOG_DIR/cleanup.txt" 2>>"$RAW_LOG" || true
  fi
  log "Cleanup finished"
}

trap cleanup EXIT

{
  echo "## Pi-Missions E2E Runner Summary"
  echo
  echo "### Environment"
  echo "- Directory: $PROJECT_DIR"
  echo "- tmux session: $SESSION_NAME"
  echo "- Pi command: $PI_CMD"
  echo "- Mode: $MODE"
  echo "- Log directory: $LOG_DIR"
  echo
  echo "### Checks"
} > "$SUMMARY"

log "Starting pi-missions e2e runner"

if [ "$MODE" != "smoke" ] && [ "$MODE" != "full" ]; then
  log "Invalid mode: $MODE"
  exit 2
fi

if [ ! -d "$PROJECT_DIR" ]; then
  echo "[ ] Project directory exists" >> "$SUMMARY"
  log "Project directory not found: $PROJECT_DIR"
  exit 1
fi

echo "[x] Project directory exists" >> "$SUMMARY"
cd "$PROJECT_DIR" || exit 1
echo "[x] Navigated to project directory" >> "$SUMMARY"

log "Checking Pi version and installed packages"
(pi --version || pi -V || true) > "$LOG_DIR/pi-version.txt" 2>&1
(pi list || true) > "$LOG_DIR/pi-list.txt" 2>&1

tmux kill-session -t "$SESSION_NAME" 2>>"$RAW_LOG" || true
echo "[x] Killed existing tmux session if present" >> "$SUMMARY"

tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR" 2>>"$RAW_LOG"
if tmux has-session -t "$SESSION_NAME" 2>>"$RAW_LOG"; then
  echo "[x] Started tmux session" >> "$SUMMARY"
else
  echo "[ ] Started tmux session" >> "$SUMMARY"
  exit 1
fi

log "Starting Pi: $PI_CMD"
tmux send-keys -t "$SESSION_NAME" "$PI_CMD" Enter 2>>"$RAW_LOG"
sleep "$WAIT_START"
capture "startup"
check_contains "$LOG_DIR/startup.txt" "pi|extensions|mission|src|index\.ts" "Pi startup produced relevant output" || true
check_contains "$LOG_DIR/startup.txt" "src|index\.ts|extension" "Extension appears loaded or referenced" || true

send_line "mission-help" "/mission " || true
check_contains "$LOG_DIR/mission-help.txt" "mission|new|list|status|metrics|next|done|block|fork|debug|dashboard" "Mission command/help appears available" || true

send_line "mission-list" "/mission list" || true
send_line "mission-status" "/mission status" || true
send_line "mission-metrics" "/mission metrics" || true
send_line "mission-debug" "/mission debug" || true

if [ "$MODE" = "full" ]; then
  send_line "mission-new" "/mission new e2e-test E2E comprehensive test" || true
  send_key "mission-new-cancel" "Escape" || true
  send_line "mission-next" "/mission next" || true
  send_line "mission-done" "/mission done" || true
  send_line "mission-block" "/mission block e2e self-block smoke test" || true
  send_line "mission-fork" "/mission fork e2e fork smoke test" || true
  send_line "mission-dashboard" "/mission dashboard" || true
  send_line "tool-registry-probe" "List the registered pi-missions tools exactly by name. Include mission_next_feature, mission_feature_done, mission_ask_user, mission_block_self, mission_fork, mission_error_status, and mission_retry_error if available." || true
  check_contains "$LOG_DIR/tool-registry-probe.txt" "mission_next_feature" "mission_next_feature observed" || true
  check_contains "$LOG_DIR/tool-registry-probe.txt" "mission_feature_done" "mission_feature_done observed" || true
  check_contains "$LOG_DIR/tool-registry-probe.txt" "mission_ask_user" "mission_ask_user observed" || true
  check_contains "$LOG_DIR/tool-registry-probe.txt" "mission_block_self" "mission_block_self observed" || true
  check_contains "$LOG_DIR/tool-registry-probe.txt" "mission_fork" "mission_fork observed" || true
  check_contains "$LOG_DIR/tool-registry-probe.txt" "mission_error_status" "mission_error_status observed" || true
  check_contains "$LOG_DIR/tool-registry-probe.txt" "mission_retry_error" "mission_retry_error observed" || true
fi

capture "final"

{
  echo
  echo "### Generated Files"
  find "$LOG_DIR" -maxdepth 1 -type f | sort | sed 's#^#- #'
} >> "$SUMMARY"

log "Runner completed. Summary: $SUMMARY"
cat "$SUMMARY"
