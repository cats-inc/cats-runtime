# MCP Configuration Guide

> Model Context Protocol (MCP) server configuration for AI agents.

## Overview

MCP (Model Context Protocol) is the AAIF standard for connecting AI agents to external tools and data sources. This document describes how to configure MCP servers for this project.

## MCP Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Host                              │
│         (Claude Desktop, Cursor, ChatGPT, etc.)         │
└────────────────────────┬────────────────────────────────┘
                         │ JSON-RPC
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    MCP Client                            │
│              (Discovers & invokes servers)               │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │MCP Server│   │MCP Server│   │MCP Server│
   │(Database)│   │  (API)   │   │ (Files)  │
   └──────────┘   └──────────┘   └──────────┘
```

## Configuration

### Claude Desktop

Location: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "project-name": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "C:/path/to/project",
      "env": {
        "DATABASE_URL": "postgresql://localhost/db"
      }
    }
  }
}
```

### Cursor IDE

Location: `.cursor/mcp.json` (project root)

```json
{
  "mcpServers": {
    "project-name": {
      "command": "node",
      "args": ["./mcp-server/index.js"]
    }
  }
}
```

## Common MCP Servers

### Database Access

```json
{
  "database": {
    "command": "uvx",
    "args": ["mcp-server-sqlite", "--db-path", "./data/database.db"]
  }
}
```

### File System

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-filesystem", "./src"]
  }
}
```

### GitHub

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-github"],
    "env": {
      "GITHUB_TOKEN": "${GITHUB_TOKEN}"
    }
  }
}
```

## Project-Specific Configuration

(Add your project's MCP server configurations here)

### Server 1: [Name]

**Purpose**: (What this server provides)

```json
{
  "server-name": {
    "command": "",
    "args": [],
    "env": {}
  }
}
```

## Security Considerations

- Never commit MCP configs with hardcoded secrets
- Use environment variables for sensitive data
- Limit server permissions to minimum required
- Review server code before enabling

## Resources

- [MCP Documentation](https://modelcontextprotocol.io)
- [MCP GitHub](https://github.com/modelcontextprotocol)
- [MCP Server Registry](https://github.com/modelcontextprotocol/servers)

---

*Last updated: YYYY-MM-DD*
