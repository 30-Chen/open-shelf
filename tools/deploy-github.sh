#!/usr/bin/env bash
# One-shot GitHub Pages deployment. Token is read from the environment only;
# it is never written to disk, git config, or the OS keychain.
set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: GITHUB_TOKEN is not set." >&2
  echo "Usage: GITHUB_TOKEN=ghp_xxx bash tools/deploy-github.sh" >&2
  exit 2
fi

OWNER="30-Chen"
REPO="open-shelf"
BRANCH="main"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API="https://api.github.com"
AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "[1/5] Verifying token..."
LOGIN="$(curl -fsS "${AUTH[@]}" "$API/user" | jq -r '.login')"
if [[ "$LOGIN" != "$OWNER" ]]; then
  echo "ERROR: token belongs to '$LOGIN', expected '$OWNER'." >&2
  exit 3
fi
echo "      account: $LOGIN"

echo "[2/5] Creating repository (reuse if present)..."
BODY="$(printf '{"name":"%s","description":"个人开源应用收藏夹：自动展示 GitHub 项目介绍与最新 Release","private":false,"auto_init":false}' "$REPO")"
HTTP="$(curl -sS -o /tmp/openshelf-repo.json -w '%{http_code}' "${AUTH[@]}" -X POST "$API/user/repos" -d "$BODY")"
case "$HTTP" in
  201) echo "      repository created" ;;
  422) echo "      repository already exists, reusing" ;;
  *) echo "ERROR: create repository failed (HTTP $HTTP)"; cat /tmp/openshelf-repo.json; exit 4 ;;
esac

echo "[3/5] Pushing local commits to $BRANCH..."
git -c credential.helper= push --quiet "https://x-access-token:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git" "${BRANCH}:${BRANCH}"
echo "      pushed $(git rev-list --count HEAD) commits / $(git ls-files | wc -l | tr -d ' ') files"

echo "[4/5] Enabling GitHub Pages..."
BODY='{"source":{"branch":"main","path":"/"}}'
HTTP="$(curl -sS -o /tmp/openshelf-pages.json -w '%{http_code}' "${AUTH[@]}" -X POST "$API/repos/$OWNER/$REPO/pages" -d "$BODY")"
if [[ "$HTTP" == "409" ]]; then
  HTTP="$(curl -sS -o /tmp/openshelf-pages.json -w '%{http_code}' "${AUTH[@]}" -X PATCH "$API/repos/$OWNER/$REPO/pages" -d "$BODY")"
fi
case "$HTTP" in
  200|201) echo "      Pages enabled" ;;
  *) echo "ERROR: Pages setup failed (HTTP $HTTP)"; cat /tmp/openshelf-pages.json; exit 5 ;;
esac

echo "[5/5] Verifying..."
PAGE_URL="$(curl -fsS "${AUTH[@]}" "$API/repos/$OWNER/$REPO/pages" | jq -r '.html_url // empty')"
echo "      repository: https://github.com/$OWNER/$REPO"
echo "      pages:      ${PAGE_URL:-https://$OWNER.github.io/$REPO/}"
echo "Done. Revoke the token at https://github.com/settings/tokens"
