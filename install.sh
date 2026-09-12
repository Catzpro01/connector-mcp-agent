#!/usr/bin/env bash
set -e

# ── Persistent Workspace Runtime — One-Line Installer ──────────────────────
# Menyiapkan shared workspace backend untuk AI agents.
# Agent dapat multitask, berbagi memori, dan mewarisi skill antar sesi.
# ──────────────────────────────────────────────────────────────────────────

echo ""
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║   Persistent Workspace Runtime Installer       ║"
echo "  ╚════════════════════════════════════════════════╝"
echo ""

# Cek npm
if ! command -v npm &>/dev/null; then
  echo "❌ npm tidak ditemukan. Install Node.js 18+ terlebih dahulu."
  exit 1
fi

# Minta Workspace URL (satu kali saat install)
if [ -z "$WORKSPACE_URL" ]; then
  read -p "🔗 Masukkan Workspace Backend URL (contoh: http://myserver.com:3210): " WORKSPACE_URL
fi

if [ -z "$WORKSPACE_URL" ]; then
  echo "❌ URL wajib diisi. Jalankan ulang dengan: WORKSPACE_URL=http://... bash install.sh"
  exit 1
fi

echo ""
echo "📦 Installing connector-cli..."
npm install -g git+https://github.com/Catzpro01/connector-mcp-agent.git --silent

# Tulis config langsung — agent tidak perlu tahu
CONFIG_DIR="$HOME/.connector-cli"
CONFIG_FILE="$CONFIG_DIR/config.json"
mkdir -p "$CONFIG_DIR"

# Ambil username OS sebagai nama agent default
AGENT_NAME="${USER:-${USERNAME:-agent}}"

# Merge dengan config yang sudah ada (jika ada)
if [ -f "$CONFIG_FILE" ]; then
  EXISTING_URL=$(python3 -c "import json,sys; d=json.load(open('$CONFIG_FILE')); print(d.get('url',''))" 2>/dev/null || echo "")
  EXISTING_AGENT=$(python3 -c "import json,sys; d=json.load(open('$CONFIG_FILE')); print(d.get('agentName',''))" 2>/dev/null || echo "")
  [ -n "$EXISTING_URL" ] && WORKSPACE_URL="$EXISTING_URL"
  [ -n "$EXISTING_AGENT" ] && AGENT_NAME="$EXISTING_AGENT"
fi

cat > "$CONFIG_FILE" <<CFGEOF
{
  "url": "$WORKSPACE_URL",
  "agentName": "$AGENT_NAME",
  "apiKey": ""
}
CFGEOF

echo ""
echo "  ✅ Workspace runtime siap."
echo "  👤 Agent Name : $AGENT_NAME"
echo "  📂 Try: connector-cli status"
echo "          connector-cli list"
echo ""
