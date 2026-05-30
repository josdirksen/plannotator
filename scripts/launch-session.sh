#!/usr/bin/env bash
# Ad-hoc session launcher for manual / visual UX testing.
#
# Creates a plan, annotate, or review session against the RUNNING daemon using the
# repo's test fixtures — no agent flow required. Prints an openable URL (auth included)
# and the daemon also opens it in the browser if no frontend is already connected.
#
# Usage:
#   ./scripts/launch-session.sh [plan|annotate|review] [fixture]
#
#   plan      [fixture]   Plan session from a markdown fixture   (default fixture: 05)
#   annotate  [fixture]   Annotate session for a markdown file   (default fixture: 05)
#   review                Review session from the current repo's LOCAL git diff
#                         (needs uncommitted changes in the cwd to show anything)
#   list                  List available fixtures
#
#   <fixture> may be: a file path, a fixture number ("12"), or a name fragment ("html").
#
# Examples:
#   ./scripts/launch-session.sh                 # plan, default fixture
#   ./scripts/launch-session.sh plan 12         # plan from tests/test-fixtures/12-*.md
#   ./scripts/launch-session.sh annotate 07     # annotate a fixture
#   ./scripts/launch-session.sh plan ./PLAN.md  # plan from an arbitrary file
#   ./scripts/launch-session.sh review          # review the working-tree diff
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="${1:-plan}" FIXTURE="${2:-}" ROOT="$ROOT" CWD_ARG="$(pwd)" python3 - <<'PY'
import glob, json, os, sys, urllib.request

mode = os.environ.get("MODE", "plan").strip()
fixture = os.environ.get("FIXTURE", "").strip()
root = os.environ["ROOT"]
cwd = os.environ["CWD_ARG"]
fixtures_dir = os.path.join(root, "tests", "test-fixtures")

def list_fixtures():
    for f in sorted(glob.glob(os.path.join(fixtures_dir, "*.md"))):
        print("   ", os.path.basename(f))

if mode in ("list", "help", "-h", "--help"):
    print("Usage: ./scripts/launch-session.sh [plan|annotate|review] [fixture]")
    print("Fixtures (tests/test-fixtures/):")
    list_fixtures()
    sys.exit(0)

daemon_path = os.path.expanduser("~/.plannotator/daemon.json")
if not os.path.exists(daemon_path):
    sys.exit("No daemon running. Start one with: plannotator daemon start")
d = json.load(open(daemon_path))
base, token = d["baseUrl"], d["authToken"]

def resolve_fixture(arg, default="05-real-world-plan.md"):
    if not arg:
        return os.path.join(fixtures_dir, default)
    if os.path.exists(arg):
        return os.path.abspath(arg)
    if arg.isdigit():
        m = sorted(glob.glob(os.path.join(fixtures_dir, f"{arg.zfill(2)}-*.md")))
        if m:
            return m[0]
    m = sorted(glob.glob(os.path.join(fixtures_dir, f"*{arg}*")))
    if m:
        return m[0]
    sys.exit(f"Fixture not found: {arg}  (try: ./scripts/launch-session.sh list)")

path = None
if mode == "plan":
    path = resolve_fixture(fixture)
    req = {"action": "plan", "origin": "claude-code", "cwd": cwd, "plan": open(path).read()}
elif mode == "annotate":
    path = resolve_fixture(fixture)
    req = {"action": "annotate", "origin": "claude-code", "cwd": cwd,
           "mode": "annotate", "filePath": path}
elif mode == "review":
    req = {"action": "review", "origin": "claude-code", "cwd": cwd, "useLocal": True}
else:
    sys.exit(f"Unknown mode: {mode}  (use: plan | annotate | review | list)")

body = json.dumps({"request": req}).encode()
r = urllib.request.Request(
    base + "/daemon/sessions", data=body, method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
try:
    resp = json.load(urllib.request.urlopen(r))
except urllib.error.HTTPError as e:
    sys.exit(f"Daemon error {e.code}: {e.read().decode()[:300]}")

sess = resp.get("session", {}) or {}
url = sess.get("url", "")
open_url = f"{url}?plannotator_auth={token}" if url else "(no url returned)"
print(f"mode     : {mode}")
if path:
    print(f"fixture  : {os.path.relpath(path, root)}")
print(f"session  : {sess.get('id')}  [{sess.get('status')}]")
print(f"browser  : {resp.get('browserAction')}")
print(f"open     : {open_url}")
PY
