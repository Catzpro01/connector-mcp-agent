# Connector MCP Agent

> High-performance Model Context Protocol (MCP) workspace bridge and remote execution runner for autonomous AI developer agents (Claude, Gemini, Cursor, Cline, Codex).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![MCP Standard](https://img.shields.io/badge/Protocol-MCP%202024--11--05-purple.svg)](https://modelcontextprotocol.io/)

---

## 🚀 Overview

**Connector MCP Agent** provides AI developer agents with direct access to dedicated remote Linux workspace sandboxes, persistent background task execution, and project memory persistence.

Instead of running heavy compilers, test suites, or background daemons directly on local development machines, agents connect through standard MCP tool calls or the included zero-configuration `connector-cli`.

### Key Benefits
- **Zero-Config Agent Onboarding**: Ready out-of-the-box. System identity and workspace endpoints are auto-detected without manual environment variable setup.
- **Persistent Multi-Tasking**: Launch background commands that survive connection drops, and reconnect at any time.
- **Isolated Workspace Containers**: Isolated rootless container sandboxes for build, test, and dependency installation.
- **Persistent Knowledge Graph**: Project context and code structure persist across agent turns and generations.

---

## 📥 Installation (Linux / Ubuntu)

### Prerequisites
- Linux / Ubuntu (20.04 LTS or newer) / WSL2
- Node.js >= 20 (`node -v`)
- Git (`git --version`)

```bash
# Verify prerequisites
node -v && git --version
```

### Option 1: Quick Automated Install (Recommended)

Clone the repository and run the setup script:

```bash
git clone https://github.com/Catzpro01/connector-mcp-agent.git
cd connector-mcp-agent
chmod +x install.sh && ./install.sh
```

### Option 2: Standard Git Clone & Build

```bash
git clone https://github.com/Catzpro01/connector-mcp-agent.git
cd connector-mcp-agent
npm install
npm run build
npm install -g .
```

### Option 3: One-Liner Setup

```bash
git clone https://github.com/Catzpro01/connector-mcp-agent.git ~/.connector-agent && cd ~/.connector-agent && npm run setup
```

---

## ⚡ Basic Verification Commands

Once installed, verify that the CLI binary is available in your PATH:

```bash
# Check version
connector-cli --version

# Quick server latency check
connector-cli ping

# Check active agent identity
connector-cli whoami

# Check server connection & workspace health
connector-cli status

# List available workspaces
connector-cli list

# Show full help menu
connector-cli help
```

Sample output:
```text
$ connector-cli --version
connector-cli v0.1.0

$ connector-cli ping
🏓 PONG! VPS di http://your-vps-ip:3210 merespons dalam 210ms (HTTP 200).

$ connector-cli whoami
👤 Identitas Agen : agent
🌐 Server VPS     : http://your-vps-ip:3210
🔑 API Key        : (default / dev)
```

---

## 💻 Usage

### 1. Interactive Workspace (TUI)
Launch the interactive workspace manager:
```bash
connector-cli
```
Inside the interactive workspace, you can switch between:
- **Tab VPS**: Interactive remote shell inside the sandbox container (`/work`).
- **Tab Disk Session**: Local project session disk, AST symbol indexer, and MCP Knowledge Graph.
- **Project List**: Browse, create, and switch between project sandboxes.

### 2. Direct Command Execution
Run commands directly in the remote container from your shell:
```bash
# Run command directly in the remote workspace
connector-cli vps "cargo test"
connector-cli vps "npm run build"
```

### 3. Background Task Multiplexing
Spawn commands that keep running in the background even if you exit:
```bash
# Open a background task
connector-cli tab new --vps build-job "npm run build:prod"

# List active background tabs
connector-cli tabs

# View real-time output of a background task
connector-cli tab attach build-job

# Stop a background task
connector-cli tab kill build-job
```

### 4. Create and Connect to Projects
```bash
# Create a new workspace sandbox
connector-cli new my-service "Backend API microservice"

# Connect to a specific workspace
connector-cli connect my-service
```

---

## 🧩 MCP Integration (Claude / Cursor / Cline)

To integrate Connector MCP directly with AI agent frameworks (Claude Desktop, Cline, Roo-Code, Cursor):

Add the server to your `mcpServers` configuration (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "connector": {
      "command": "connector-cli",
      "args": ["mcp"]
    }
  }
}
```

Or connect via remote HTTP/SSE endpoint directly:

```json
{
  "mcpServers": {
    "connector-remote": {
      "type": "http",
      "url": "http://your-vps-ip:3210/mcp"
    }
  }
}
```

---

## 📑 Core Tool Reference

| Tool | Category | Description |
|---|---|---|
| `project.list` | Workspace | List all active project sandboxes on the VPS |
| `project.create` | Workspace | Initialize a new isolated project container |
| `session.enter` | Session | Attach agent session to a project workspace |
| `exec.run` | Execution | Run a command synchronously inside the container |
| `memory.read_graph` | Context | Retrieve permanent Knowledge Graph memory |
| `memory.search_nodes` | Context | Query concepts, entities, and relations |
| `code.search` | Codebase | Fast Cursor-style AST symbol and code search |
| `code.symbol` | Codebase | Locate symbol definitions (functions, classes) |
| `code.outline` | Codebase | Hierarchical outline of symbols in a file |

---

## ⚙️ Optional Configuration

Connector works with **zero manual configuration**. If custom settings are needed:

```bash
# Set custom VPS endpoint
connector-cli setting set serverUrl http://your-vps:3210

# Set agent identity
connector-cli setting set agentName my-agent
```

Configuration is automatically stored in `~/.connector-cli/config.json`.

---

## 📄 License

MIT License © 2026. Designed for agentic developer workflows.
