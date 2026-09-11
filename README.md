# Connector MCP — Remote VPS Workspace & Task Multiplexer for AI Agents

> High-performance Model Context Protocol (MCP) bridge that connects AI coding agents to remote cloud VPS environments, isolated container execution sandboxes, background task multiplexing, and persistent state across multi-tasking sessions.

---

## 🚀 Overview

**Connector** is designed for modern AI developer agents (Claude, Gemini, Cline, Roo, Cursor, etc.) that need access to high-performance remote computing environments without overloading or cluttering local developer machines.

By connecting to a Connector MCP Server on your VPS, your AI agent can:
- **Execute Long-Running Tasks**: Compile large codebases, run test suites, and execute background tasks that persist even if your agent disconnects.
- **Multi-Task Seamlessly**: Open multiple workspace tabs, switch between interactive shells and local session disks, and monitor jobs simultaneously.
- **Isolated Sandboxing**: Each project runs inside an isolated container sandbox with zero risk to the host machine.
- **State & Memory Continuity**: Project memory graphs and ledger records ensure seamless continuity across agent sessions and generations.

---

## 🛠 Features

### 1. Remote VPS Execution via Pure MCP
- Standard JSON-RPC 2.0 protocol over HTTP / Streamable SSE.
- Direct execution inside containerized project sandboxes (`/workspace` and `/work`).
- Full support for interactive shell commands, background daemons, and output streaming.

### 2. Multi-Tasking & Tab Multiplexing
- Run background tasks (`task run <cmd>`) that keep executing in the background.
- Attach, inspect, and kill background tasks on demand.
- Switch between multiple concurrent workspaces without losing execution context.

### 3. Session Disk & Memory Graph
- Dedicated local session disk per project (`~/.connector-cli/sessions/<project>`).
- Fast offline memory cache and Knowledge Graph exploration (`graph`, `search`, `node`).
- Cursor-style fast AST symbol and code indexing (`code`, `symbol`, `outline`).

---

## 📦 Quick Start

### Installation

Install the Connector CLI on the agent's machine:

```bash
npm install -g connector-mcp-cli
```

### Configuration

Set your VPS connection credentials (provided once by your administrator):

```bash
export CONNECTOR_URL="http://your-vps-ip:3210"
export CONNECTOR_API_KEY="your-secret-api-key"
```

### Connecting to a Project

Launch the interactive workspace or connect directly to a project:

```bash
# Launch interactive project picker & multitasking shell
connector-cli

# Connect directly to a specific project
connector-cli connect <project-name>
```

Inside the interactive project workspace:
- **Tab VPS**: Interactive remote shell inside the VPS container.
- **Tab Disk Session**: Local project session disk, Knowledge Graph memory, and code navigation.
- **Background Tasks**: Spawn, manage, and monitor long-running background tasks.

---

## 📑 MCP Tool Catalog

| Tool Name | Description |
|---|---|
| `project.list` | List all available project workspaces on the VPS |
| `project.open` | Open a project container and set default workspace |
| `exec.run` | Execute a shell command inside the project container |
| `exec.run-background` | Spawn a background task that survives disconnects |
| `exec.attach` | Inspect output and status of a running task |
| `exec.list` | List all running and completed background tasks |
| `exec.kill` | Terminate a running background task |
| `fs.read` | Read a file from the container workspace |
| `fs.write` | Write a file to the container workspace |
| `fs.list` | List files and directories in the workspace |
| `memory.read_graph` | Retrieve the project's permanent Knowledge Graph |
| `memory.search_nodes` | Search entities and relations in the Knowledge Graph |

---

## 🔒 Security & Sandboxing

- **Rootless Container Isolation**: All code execution occurs within dedicated Podman container sandboxes.
- **Scoped Mounts**: Each container only has access to its assigned project directory.
- **Network Boundaries**: Container network isolation ensures safe execution of untrusted third-party code.

---

## 📄 License

MIT License. Designed for agentic workflows and automated developer pair-programming.

