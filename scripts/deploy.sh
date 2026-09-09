#!/usr/bin/env bash
#
# Deploy, alias, and prove the live site is serving the commit you just built.
#
# This exists because the manual version failed silently and nearly produced a
# false result. The deploy printed a URL in a shape the extracting grep did not
# match, so the alias step was handed an empty string and refused; production
# stayed forty minutes stale; and a round of measurements against the old build
# was very nearly reported as evidence that a fix worked.
#
# Every step here is checked, and the last step is the one that matters: it asks
# the live domain which commit it is running and refuses to agree that the
# deploy happened unless the answer is HEAD.
#
#   scripts/deploy.sh              deploy HEAD to production and verify
#   scripts/deploy.sh --skip-tests skip the suite (use when you just ran it)
#
set -euo pipefail

DOMAIN="${YUZU_DOMAIN:-yuzu-market.vercel.app}"
SKIP_TESTS="${1:-}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# ── the tree must be committed, or the deploy and the SHA disagree ──────────
# Vercel deploys the working directory but reports the git commit. Uncommitted
# changes would ship while the marker below claims a commit that does not
# contain them, which is a worse lie than no marker at all.
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  die "the working tree is dirty. Commit first, or the build marker will name a commit that does not match what shipped."
fi

HEAD_SHA="$(git rev-parse HEAD)"
say "Deploying ${HEAD_SHA:0:8} to ${DOMAIN}"

if [ "$SKIP_TESTS" != "--skip-tests" ]; then
  say "Tests"
  npx vitest run >/dev/null 2>&1 || die "the test suite is red. Not deploying."
  npx tsc --noEmit || die "typecheck failed. Not deploying."
fi

say "Building"
npm run build >/dev/null 2>&1 || die "the build failed. Not deploying."

# ── deploy ─────────────────────────────────────────────────────────────────
# `--yes` so it never waits on a prompt; the URL is read from the last line
# rather than pattern-matched out of a paragraph, which is what broke before.
say "Uploading"
DEPLOY_LOG="$(mktemp)"
npx vercel --prod --yes >"$DEPLOY_LOG" 2>&1 || { cat "$DEPLOY_LOG"; die "vercel deploy exited non-zero"; }

TARGET="$(grep -oE 'https://[a-z0-9-]+\.vercel\.app' "$DEPLOY_LOG" | tail -1 || true)"
[ -n "$TARGET" ] || { cat "$DEPLOY_LOG"; die "could not read a deployment URL from the vercel output"; }
printf '  deployment: %s\n' "$TARGET"

say "Aliasing"
npx vercel alias set "$TARGET" "$DOMAIN" >/dev/null 2>&1 \
  || die "alias failed. ${DOMAIN} is still pointing at the previous deployment."

# ── the check that makes the rest trustworthy ──────────────────────────────
# An alias can report success and still take a moment to propagate, so this
# polls rather than asking once, and it compares the commit the live domain
# reports against the commit we just built.
say "Verifying the live domain is serving ${HEAD_SHA:0:8}"
for attempt in $(seq 1 15); do
  LIVE="$(curl -fsS "https://${DOMAIN}/api/health" -m 30 2>/dev/null \
          | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).build?.commit??""))}catch{process.stdout.write("")}})' \
          2>/dev/null || true)"
  if [ "$LIVE" = "$HEAD_SHA" ]; then
    printf '  live commit: %s\n' "${LIVE:0:8}"
    say "Deployed and verified."
    rm -f "$DEPLOY_LOG"
    exit 0
  fi
  printf '  attempt %s: live reports %s\n' "$attempt" "${LIVE:0:8}${LIVE:+ }${LIVE:-<no answer>}"
  sleep 4
done

die "${DOMAIN} is not serving ${HEAD_SHA:0:8}. Do not trust any measurement taken against it."
