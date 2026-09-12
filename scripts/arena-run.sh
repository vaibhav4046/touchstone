#!/usr/bin/env bash
#
# Keep Yuzu in the Room. Forever.
#
# The agent's own loop already survives network failures, a rejected seat, a
# malformed message from another team, and an unhandled rejection. This is for
# the things a process cannot catch about itself: the runtime dying, the
# machine running out of memory, a stray Ctrl-C in the wrong window.
#
# The hard rule is that an agent absent from either Arena round is not judged at
# all. So the supervisor has no give-up condition and no maximum restart count.
# It logs, waits five seconds, and puts the agent back in the Room.
#
#   bash scripts/arena-run.sh              run in the foreground, Ctrl-C twice to stop
#   bash scripts/arena-run.sh --dry-run    answer nothing, print what it would say
#
# Everything it needs is in .env.local: SHAREDNET_INSTANCE_TOKEN (or
# SHAREDNET_API_KEY, from which it can mint a replacement seat) and
# SHAREDNET_ROOM.
set -uo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
else
  echo "No .env.local. The agent needs SHAREDNET_INSTANCE_TOKEN and SHAREDNET_ROOM." >&2
  exit 1
fi

export SHAREDNET_MEMBER_TOKEN="${SHAREDNET_MEMBER_TOKEN:-${SHAREDNET_INSTANCE_TOKEN:-}}"
export SHAREDNET_ROOM="${SHAREDNET_ROOM:-rom_TxTzqEUKyx}"
export YUZU_BASE_URL="${YUZU_BASE_URL:-https://yuzu-market.vercel.app}"

mkdir -p work
LOG="work/arena-agent.log"

printf '\n=== supervisor up %s ===\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee -a "$LOG"
echo "Room ${SHAREDNET_ROOM} · answering with ${YUZU_BASE_URL} · log ${LOG}"

# Ctrl-C stops the supervisor rather than only the child, which otherwise takes
# two interrupts and leaves people unsure whether it actually stopped.
trap 'echo; echo "supervisor stopped by hand."; exit 0' INT TERM

restarts=0
while true; do
  node --import tsx scripts/arena-agent.mts "$@" 2>&1 | tee -a "$LOG"

  restarts=$((restarts + 1))
  printf '[%s] agent exited; restart #%s in 5s\n' "$(date -u '+%H:%M:%SZ')" "$restarts" | tee -a "$LOG"
  sleep 5
done
