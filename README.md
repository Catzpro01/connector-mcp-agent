# Connector CLI (agent side)

The agent side of the Connector MCP Server. One binary per agent machine:

- `connector-cli connect <project>` — inherit the project's memory, download its skills to a per-session Session Disk, register the Connector in the agent's MCP config
- `connector-cli list | inherit | status` — projects, memory, health
- `connector-cli login` — no-password login name, stored in the Local Disk (`~/.connector-cli`)
- `connector-cli task run/list/attach/kill` — Local Tasks: background "tabs" on the agent's own machine

Requires `CONNECTOR_URL` and `CONNECTOR_API_KEY` in the environment (provided once by the owner).
