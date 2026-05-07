#!/usr/bin/env bash
# 一键安装 pre-commit 钩子：每次 commit 前自动跑 sync-share-version.mjs
# 这样图片改动一旦进入 staged，对应的 og:image 版本号会被同步更新并补加到本次提交
#
# 使用方法（仅需运行一次）：
#   bash scripts/install-hooks.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_DIR="$ROOT/.git/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

if [ ! -d "$ROOT/.git" ]; then
  echo "[install-hooks] 当前目录不是 git 仓库根，跳过：$ROOT"
  exit 0
fi

mkdir -p "$HOOK_DIR"

cat > "$HOOK_FILE" <<'HOOK'
#!/usr/bin/env bash
# 自动同步分享图版本号 → 把变更后的 quiz-h5.html / share-dX.html 一起 add 进本次提交
ROOT="$(git rev-parse --show-toplevel)"

# 寻找一个可用的 node 可执行：PATH > nvm > workbuddy > Homebrew
find_node() {
  if command -v node >/dev/null 2>&1; then echo "node"; return; fi
  for p in \
    "$HOME/.nvm/versions/node/"*/bin/node \
    "$HOME/.workbuddy/binaries/node/versions/"*/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  echo ""
}

NODE_BIN="$(find_node)"
if [ -n "$NODE_BIN" ]; then
  "$NODE_BIN" "$ROOT/scripts/sync-share-version.mjs" || {
    echo "[pre-commit] sync-share-version 失败，但不阻塞提交" >&2
  }
  git -C "$ROOT" add quiz-h5.html share-d1.html share-d2.html share-d3.html share-d4.html share-d5.html share-d6.html 2>/dev/null || true
else
  echo "[pre-commit] 未找到 node，跳过分享图版本号同步" >&2
fi
exit 0
HOOK

chmod +x "$HOOK_FILE"
echo "[install-hooks] 已安装 $HOOK_FILE"
