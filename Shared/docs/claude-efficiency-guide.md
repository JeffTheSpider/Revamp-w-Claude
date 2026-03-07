# Claude Code Efficiency Maximization Guide

**Created**: March 7, 2026  
**Scope**: Complete reference for settings, configuration, MCP, hooks, skills, agents, keyboard shortcuts, and performance optimization  
**Document Version**: 1.0

---

## Table of Contents

1. [Configuration System](#1-configuration-system)
2. [Hooks: Lifecycle Automation](#2-hooks-lifecycle-automation)
3. [MCP Servers: External Tool Integration](#3-mcp-servers-external-tool-integration)
4. [Skills: Reusable Workflows](#4-skills-reusable-workflows)
5. [Subagents & Agent Teams](#5-subagents--agent-teams)
6. [Memory System](#6-memory-system)
7. [Context Window Optimization](#7-context-window-optimization)
8. [Keyboard Shortcuts & Customization](#8-keyboard-shortcuts--customization)
9. [Model Selection & Performance](#9-model-selection--performance)
10. [IDE Integrations](#10-ide-integrations)
11. [Plugins: Packaging & Distribution](#11-plugins-packaging--distribution)
12. [Git Worktrees & Parallel Work](#12-git-worktrees--parallel-work)
13. [Scheduled Tasks](#13-scheduled-tasks)
14. [Advanced Patterns & Best Practices](#14-advanced-patterns--best-practices)

---

## 1. Configuration System

### Overview
Claude Code uses a **hierarchical, scope-based configuration system** with these layers (highest to lowest precedence):

1. **Managed** (IT-deployed) → System-wide, non-overridable
2. **CLI flags** → One-time session overrides
3. **Local** (`.claude/*.local.*`) → Personal project overrides, gitignored
4. **Project** (`.claude/`) → Team-shared, version-controlled
5. **User** (`~/.claude/`) → Personal across all projects

### Configuration Files

#### `settings.json` (Primary)
Located at: `~/.claude/settings.json` (user), `.claude/settings.json` (project), `.claude/settings.local.json` (local)

**Full Example:**
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Read(~/.zshrc)",
      "Skill(commit)",
      "Agent(Explore)"
    ],
    "deny": [
      "Bash(curl *)",
      "Read(./.env)",
      "Read(./secrets/**)",
      "WebFetch",
      "Agent(my-dangerous-agent)"
    ],
    "ask": [
      "Write(CLAUDE.md)"
    ]
  },
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "PATH": "/usr/local/bin:/usr/bin",
    "API_KEY": "${API_KEY:-default_value}"
  },
  "sandbox": {
    "enabled": true,
    "paths": [
      "/tmp/claude-safe",
      "/dev/null"
    ]
  },
  "model": "sonnet",
  "outputStyle": "Explanatory",
  "language": "english",
  "autoMemoryEnabled": true,
  "disableAllHooks": false,
  "claudeMdExcludes": [
    "**/monorepo/CLAUDE.md",
    "/path/to/other-team/.claude/rules/**"
  ],
  "forceLoginMethod": "claudeai"
}
```

**Key Settings:**
- **`permissions`**: Three levels: `allow`, `deny`, `ask` (evaluated: deny → ask → allow)
- **`env`**: Environment variables injected into all sessions
- **`sandbox`**: Advanced bash isolation config
- **`model`**: Default model (`sonnet`, `opus`, `haiku`, or alias)
- **`autoMemoryEnabled`**: Toggle auto-memory (default: `true`)
- **`claudeMdExcludes`**: Glob patterns to skip CLAUDE.md files

**Permission Rule Syntax:**
```
Tool                          # Match all uses
Tool(specifier)               # Fine-grained control
Tool(pattern *)               # Wildcard patterns
Bash(npm run *)               # Allow npm run (any args)
Bash(curl *)                  # Deny all curl variants
Read(./secrets/**)            # Recursive directory match
Agent(worker, researcher)     # Specific subagent names
MCP(github)                   # Specific MCP server tools
```

#### `CLAUDE.md` Files
The memory and instructions system. See [Memory System](#6-memory-system) for full details.

**Locations (priority order):**
- Managed policy: `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS)
- Project: `./CLAUDE.md` or `./.claude/CLAUDE.md`
- User: `~/.claude/CLAUDE.md`
- Local: `./CLAUDE.local.md` (gitignored)

#### `.claude/rules/` Directory
Organize instructions by topic. Each `.md` file is a rule that can be scoped to specific paths.

**Example Structure:**
```
.claude/rules/
├── testing.md              # Loaded unconditionally
├── frontend/
│   ├── react.md            # Loaded when working with frontend files
│   └── styling.md
└── backend/
    └── api-design.md
```

**With Path-Specific Rules:**
```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Design Rules
- Use RESTful naming conventions
- Return consistent error formats
```

#### `.claude/.mcp.json` (MCP Server Config)
Shared MCP server configurations for the project (checked into git).

**Example:**
```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    },
    "local-db": {
      "type": "stdio",
      "command": "python",
      "args": ["/path/to/db-server.py"],
      "env": {
        "DB_URL": "postgresql://localhost/mydb"
      }
    }
  }
}
```

#### `~/.claude.json` (Cached Data)
Internal file storing OAuth sessions, MCP credentials, and plugin cache. Not typically edited manually.

---

### Verify Active Settings

Run `/status` in a session to see:
- Which settings files are active
- Where each setting comes from
- Current context window usage
- Active hooks

Example output:
```
Settings:
  User: ~/.claude/settings.json
  Project: .claude/settings.json (OVERRIDE: model = sonnet)
  Managed: /Library/Application Support/ClaudeCode/managed-settings.json

Context:
  Used: 8,192 / 200,000 tokens (4%)
  Warnings: None
```

---

### Windows-Specific Configuration

**User home directory:**
```
C:\Users\<username>\.claude\
```

**Managed policy location:**
```
C:\Program Files\ClaudeCode\
```

**MCP stdio servers on Windows:**
Must use `cmd /c` wrapper for `npx`:
```bash
claude mcp add --transport stdio my-server -- cmd /c npx -y @some/package
```

---

## 2. Hooks: Lifecycle Automation

Hooks are shell commands that execute at specific lifecycle points. They provide deterministic control over behavior (unlike relying on LLM to decide).

### Hook Event Types

| Event | When It Fires | Matcher Input | Example Use |
|-------|---------------|---------------|-------------|
| `SessionStart` | Session begins/resumes | `startup`, `resume`, `clear`, `compact` | Re-inject context after compaction |
| `InstructionsLoaded` | CLAUDE.md loaded | `startup`, `lazy` | Log which instructions loaded |
| `UserPromptSubmit` | User submits prompt | (no matcher) | Validate user input |
| `PreToolUse` | Before tool executes | Tool name (`Bash`, `Edit`, etc.) | Block dangerous commands |
| `PermissionRequest` | Permission dialog shown | Tool name | Auto-approve certain tools |
| `PostToolUse` | After tool succeeds | Tool name | Format code with Prettier |
| `PostToolUseFailure` | After tool fails | Tool name | Log failures |
| `Notification` | Alert needed | `permission_prompt`, `idle_prompt`, etc. | Desktop notifications |
| `SubagentStart` | Subagent spawns | Agent type name | Setup subagent context |
| `SubagentStop` | Subagent finishes | Agent type name | Cleanup resources |
| `Stop` | Claude finishes response | (no matcher) | Verify work complete |
| `TeammateIdle` | Agent team member idle | (no matcher) | Keep teams active |
| `TaskCompleted` | Task marked complete | (no matcher) | Archive task |
| `ConfigChange` | Config file changes | `user_settings`, `project_settings`, etc. | Audit changes |
| `WorktreeCreate` | Worktree being created | (no matcher) | Customize git setup |
| `WorktreeRemove` | Worktree being removed | (no matcher) | Cleanup worktrees |
| `PreCompact` | Before context compaction | `manual`, `auto` | Save state |
| `SessionEnd` | Session terminates | `clear`, `logout`, etc. | Final cleanup |

### Hook Configuration (In Settings)

**Basic Command Hook:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx prettier --write $FILE_PATH"
          }
        ]
      }
    ]
  }
}
```

**Structured JSON Output (Advanced):**
```bash
#!/bin/bash
INPUT=$(cat)

# Deny with reason
echo '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Use rg instead of grep"
  }
}'
exit 0
```

**HTTP Hook:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:8080/hooks/tool-use",
            "headers": {
              "Authorization": "Bearer $API_TOKEN"
            },
            "allowedEnvVars": ["API_TOKEN"]
          }
        ]
      }
    ]
  }
}
```

**Prompt-Based Hook (AI Decision):**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Are all requested tasks complete? If not, respond with {\"ok\": false, \"reason\": \"what remains\"}"
          }
        ]
      }
    ]
  }
}
```

**Agent-Based Hook (Complex Verification):**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Verify tests pass: Run `npm test` and check results. $ARGUMENTS",
            "timeout": 120,
            "agent": "Explore"
          }
        ]
      }
    ]
  }
}
```

### Practical Hook Examples

**Example 1: Desktop Notification on Wait**
```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Code needs your attention\" with title \"Claude Code\"'"
          }
        ]
      }
    ]
  }
}
```

**Example 2: Protect Sensitive Files**
```bash
#!/bin/bash
# .claude/hooks/protect-files.sh
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

PROTECTED=(".env" "package-lock.json" ".git/")
for pattern in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: Protected file" >&2
    exit 2
  fi
done
exit 0
```

Then register in settings:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/hooks/protect-files.sh"
          }
        ]
      }
    ]
  }
}
```

**Example 3: Audit Configuration Changes**
```json
{
  "hooks": {
    "ConfigChange": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "jq -c '{timestamp: now | todate, source: .source, file: .file_path}' >> ~/.claude/audit.log"
          }
        ]
      }
    ]
  }
}
```

### Hook Exit Codes

| Exit Code | Behavior | Use Case |
|-----------|----------|----------|
| `0` | Proceed normally; stdout can contain JSON or context | Success, allow action |
| `2` | Block action; stderr is feedback to Claude | Deny tool call, explain why |
| Other | Proceed; stderr logged but not shown | Logging without blocking |

### Hook Input/Output

**Hook receives JSON on stdin:**
```json
{
  "session_id": "abc123",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test"
  }
}
```

**Hook sends JSON on stdout to control behavior:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "Optional explanation"
  }
}
```

### Hook Locations

Save hooks at:
- **User**: `~/.claude/settings.json` (applies everywhere)
- **Project**: `.claude/settings.json` (shared with team)
- **Local**: `.claude/settings.local.json` (personal, gitignored)
- **Skill/Agent**: Inline in frontmatter (scoped to that component)

### Interactive Hook Setup

Run `/hooks` to open the interactive menu:
- Browse all hook events
- Create new hooks with guided prompts
- Edit or delete existing hooks
- Toggle all hooks on/off

---

## 3. MCP Servers: External Tool Integration

MCP (Model Context Protocol) connects Claude to hundreds of external tools and services.

### Popular MCP Servers

**Code & Git:**
- `github` - GitHub API, PRs, issues, repos
- `gitlab` - GitLab integration
- GitHub Copilot (built-in when on GitHub Copilot plan)

**Data & Databases:**
- `filesystem` - Local file operations
- `postgresql` - PostgreSQL queries
- `mysql` - MySQL/MariaDB queries
- `sentry` - Error tracking and monitoring
- `datadog` - Infrastructure and APM monitoring

**Productivity:**
- `slack` - Send messages, read channels
- `gmail` - Email operations
- `jira` - Issue tracking
- `asana` - Project management
- `notion` - Notion workspace access

**APIs & Services:**
- `stripe` - Payment processing
- `anthropic` - Claude API reference (automatic when importing SDK)
- `openai` - OpenAI integration
- `sendgrid` - Email sending
- `twilio` - SMS/voice

**DevOps & Infrastructure:**
- `docker` - Docker container management
- `kubernetes` - K8s cluster operations
- `aws` - AWS services
- `gcp` - Google Cloud Platform
- `terraform` - Infrastructure as code

**Browse hundreds more:** https://github.com/modelcontextprotocol/servers

### Installing MCP Servers

**Option 1: HTTP Server (Remote, Recommended)**
```bash
# Format: claude mcp add --transport http <name> <url>

claude mcp add --transport http github https://api.githubcopilot.com/mcp/
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
claude mcp add --transport http stripe https://mcp.stripe.com
```

**Option 2: SSE Server (Remote, Deprecated)**
```bash
claude mcp add --transport sse asana https://mcp.asana.com/sse
```

**Option 3: Stdio Server (Local, Process-based)**
```bash
# For npm packages
claude mcp add --transport stdio airtable \
  --env AIRTABLE_API_KEY=YOUR_KEY \
  -- npx -y airtable-mcp-server

# For Python
claude mcp add --transport stdio postgres \
  -- python /path/to/postgres-server.py

# For any executable
claude mcp add --transport stdio my-tool -- /usr/local/bin/my-tool-server
```

**Option 4: Direct JSON Configuration**
```bash
claude mcp add-json weather-api \
  '{"type":"http","url":"https://api.weather.com/mcp"}'
```

### MCP Installation Scopes

| Scope | Location | Sharing | Use Case |
|-------|----------|---------|----------|
| **Local** (default) | `~/.claude.json` | Personal, project-specific | Personal development, sensitive creds |
| **Project** | `.mcp.json` (git) | Team, version-controlled | Shared team integrations |
| **User** | `~/.claude.json` | Personal, all projects | Personal utilities, cross-project tools |
| **Managed** | System paths | Organization-wide | Enterprise policy enforcement |

**Examples:**
```bash
# Project-scoped (shared with team)
claude mcp add --scope project --transport http github https://api.githubcopilot.com/mcp/

# User-scoped (personal, all projects)
claude mcp add --scope user --transport http stripe https://mcp.stripe.com

# Local-scoped (default, personal, this project only)
claude mcp add --transport http local-api http://localhost:8080/mcp
```

### Managing MCP Servers

```bash
# List all configured servers
claude mcp list

# Get details for a specific server
claude mcp get github

# Remove a server
claude mcp remove github

# Reset approval choices (project-scoped only)
claude mcp reset-project-choices

# View in Claude Code
/mcp
```

### Authentication

Many MCP servers require OAuth 2.0 authentication:

```bash
# Add server
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Authenticate within Claude Code
/mcp
# → Select Sentry → Follow browser login
# → Token auto-stored securely
```

**Pre-configured OAuth Credentials:**
```bash
# If server requires pre-registered credentials
claude mcp add --transport http \
  --client-id your-client-id \
  --client-secret \
  --callback-port 8080 \
  my-server https://mcp.example.com/mcp
```

### Dynamic Tool Updates

MCP servers can send `list_changed` notifications to dynamically update available tools without reconnecting.

### MCP Environment Variables

Configure in `.mcp.json`:
```json
{
  "mcpServers": {
    "api": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```

Supported syntax:
- `${VAR}` - Expands to environment variable
- `${VAR:-default}` - Fallback if not set

### Practical MCP Workflows

**Example 1: GitHub Code Review**
```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp/
```

Then in Claude:
```
/mcp
# → Authenticate with GitHub

Review PR #456 and suggest improvements
Show me all open PRs assigned to me
Create an issue for the bug we just found
```

**Example 2: PostgreSQL Queries**
```bash
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub \
  --dsn "postgresql://user:pass@localhost:5432/mydb"
```

Then in Claude:
```
What's the schema for the users table?
Find customers who haven't purchased in 90 days
Show me the top 10 sellers this month
```

**Example 3: Sentry Error Monitoring**
```bash
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
/mcp  # Authenticate
```

Then in Claude:
```
What are the most common errors in the last 24 hours?
Show me the stack trace for error ID abc123
Which deployment introduced these new errors?
```

### MCP Output Limits

- **Warning threshold**: 10,000 tokens per tool output
- **Default max**: 25,000 tokens
- **Configure**: `MAX_MCP_OUTPUT_TOKENS=50000 claude`

### MCP Tool Search

When many MCP tools are configured:
- **Auto mode** (default): Defers tools if >10% of context
- **Threshold**: Customize with `ENABLE_TOOL_SEARCH=auto:5` (5% threshold)
- **Disable**: `ENABLE_TOOL_SEARCH=false`

Set in environment or settings:
```json
{
  "env": {
    "ENABLE_TOOL_SEARCH": "auto:5"
  }
}
```

---

## 4. Skills: Reusable Workflows

Skills are self-contained, reusable workflows that Claude can invoke automatically or you can trigger manually with `/skill-name`.

### Skill Locations

| Location | Scope | Priority | Use Case |
|----------|-------|----------|----------|
| `~/.claude/skills/` | Personal, all projects | 3 | Cross-project utilities |
| `.claude/skills/` | Project-specific | 2 | Team-shared workflows |
| Plugin's `skills/` | Where plugin enabled | 4 | Distributed skills |

### Basic Skill Structure

**Required:** `SKILL.md` file with YAML frontmatter + markdown instructions

```
my-skill/
├── SKILL.md              # Required: instructions + config
├── template.md           # Optional: template to fill
├── examples/
│   └── sample.md         # Optional: example output
└── scripts/
    └── helper.py         # Optional: executable script
```

### Skill Example

**File:** `~/.claude/skills/explain-code/SKILL.md`
```yaml
---
name: explain-code
description: Explains code with visual diagrams and analogies. Use when explaining how code works.
argument-hint: "[filepath]"
disable-model-invocation: false
user-invocable: true
allowed-tools: Read, Grep, Glob
---

When explaining code, always include:

1. **Start with an analogy**: Compare to something from everyday life
2. **Draw a diagram**: Show flow/structure with ASCII art
3. **Walk through code**: Step-by-step explanation
4. **Highlight gotchas**: Common mistakes or misconceptions

Keep explanations conversational and clear.
```

**Invoke it:**
```
/explain-code src/auth/login.ts
```

Or Claude invokes automatically:
```
How does this code work?
```

### Frontmatter Configuration

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| `name` | No | Skill identifier for `/` command | `explain-code` |
| `description` | Recommended | When/why to use it | "Explains code with diagrams" |
| `argument-hint` | No | Expected arguments shown in autocomplete | `[file] [format]` |
| `disable-model-invocation` | No | If `true`, Claude can't auto-invoke | `true` |
| `user-invocable` | No | If `false`, hides from `/` menu | `false` |
| `allowed-tools` | No | Tools available without permission | `Read, Grep, Bash` |
| `model` | No | Override model: `sonnet`, `opus`, `haiku`, `inherit` | `sonnet` |
| `context` | No | Run in subagent: set to `fork` | `fork` |
| `agent` | No | Which subagent to use with `context: fork` | `Explore` |
| `hooks` | No | Lifecycle hooks for this skill | See hooks docs |

### String Substitutions in Skills

| Variable | Value | Example |
|----------|-------|---------|
| `$ARGUMENTS` | All arguments passed | `/skill-name arg1 arg2` → "arg1 arg2" |
| `$ARGUMENTS[0]` | First argument | `/migrate App React Vue` → "App" |
| `$0`, `$1`, etc. | Shorthand for positional | `$0` = first arg |
| `${CLAUDE_SESSION_ID}` | Current session ID | For logging/correlation |
| `${CLAUDE_SKILL_DIR}` | Skill directory path | For scripts bundled with skill |

### Advanced Patterns

**Dynamic Context Injection:**
```yaml
---
name: pr-summary
description: Summarize PR changes
---

# PR Context
- Diff: !`gh pr diff`
- Comments: !`gh pr view --comments`
- Files: !`gh pr diff --name-only`

Summarize this PR...
```

The `!`command\`\` syntax runs the command and injects output before Claude sees the prompt.

**Skill Running in Subagent:**
```yaml
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---

Research $ARGUMENTS thoroughly:

1. Find relevant files
2. Read and analyze code
3. Summarize findings
```

**Bundle Supporting Files:**

Skill content:
```markdown
## Additional Resources

- For complete API details, see [reference.md](reference.md)
- For examples, see [examples.md](examples.md)
```

Claude automatically reads these when referenced.

### Bundled Skills (Built-in)

Claude Code includes these powerful bundled skills:

- **`/simplify`** - Review changed code for quality, parallelizes 3 agents
- **`/batch <instruction>`** - Parallel changes across 5-30 worktrees
- **`/debug [description]`** - Troubleshoot current session
- **`/loop [interval] <prompt>`** - Run prompt on schedule
- **`/claude-api`** - Load Claude API + Agent SDK reference

### Invoking Skills

**Directly (with `/` prefix):**
```
/explain-code src/auth/login.ts
/fix-issue 123
/migrate-component SearchBar React Vue
```

**Claude invokes automatically** based on description matching conversation context.

**With arguments:**
```yaml
---
name: fix-issue
description: Fix a GitHub issue
---

Fix GitHub issue $ARGUMENTS following our standards.
```

Run:
```
/fix-issue 456
```

Claude receives: "Fix GitHub issue 456 following our standards."

### Practical Skill Examples

**Example 1: Code Improvement Skill**
```yaml
---
name: improve-code
description: Review code for improvements
allowed-tools: Read, Grep, Glob, Bash
model: inherit
---

Review this code for:
- Readability and clarity
- Performance optimizations
- Best practices
- Code duplication
- Security issues

Provide specific, actionable suggestions with examples.
```

**Example 2: Deployment Skill** (user-triggered only)
```yaml
---
name: deploy-prod
description: Deploy application to production
disable-model-invocation: true
allowed-tools: Bash(npm run deploy), Read
---

Deploy to production:
1. Run `npm run build`
2. Run tests: `npm run test:prod`
3. Execute: `npm run deploy`
4. Verify deployment success
```

**Example 3: Data Analysis Skill**
```yaml
---
name: analyze-logs
description: Analyze log files and extract insights
allowed-tools: Read, Bash, Grep
---

Analyze the provided logs:

1. Identify error patterns
2. Extract statistics (request rates, errors, latency)
3. Highlight anomalies
4. Suggest fixes

Provide clear, data-driven recommendations.
```

---

## 5. Subagents & Agent Teams

### Subagents Overview

Subagents are specialized AI assistants that run in isolated contexts with custom prompts, tool restrictions, and permissions. Use them to:

- **Preserve main context** by keeping exploration/implementation separate
- **Enforce constraints** (read-only, specific tools only)
- **Reuse across projects** (user-level subagents)
- **Control costs** (route to faster/cheaper models like Haiku)
- **Specialize behavior** (domain-specific prompts)

### Built-in Subagents

| Agent | Model | Tools | Purpose | When Claude Uses It |
|-------|-------|-------|---------|-------------------|
| **Explore** | Haiku | Read-only | Codebase exploration | When searching/analyzing without changes |
| **Plan** | Inherits | Read-only | Research for planning | Plan mode research phase |
| **general-purpose** | Inherits | All | Complex multi-step tasks | Tasks needing both exploration + modification |
| **Bash** | Inherits | Bash only | Terminal command execution | Running commands in isolation |

### Creating Subagents

**Method 1: Interactive Menu (Recommended)**
```
/agents
→ Create new agent
→ User-level (all projects) or Project-level
→ Describe what you want: "A code reviewer that analyzes files..."
→ Select tools
→ Select model
→ Save
```

**Method 2: Manual File**

Create: `~/.claude/agents/code-reviewer/code-reviewer.md`
```markdown
---
name: code-reviewer
description: Expert code reviewer. Proactively reviews code quality and security.
tools: Read, Grep, Glob, Bash
model: sonnet
permissionMode: default
maxTurns: 20
---

You are a senior code reviewer ensuring high quality and security standards.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Provide feedback organized by priority

Review for:
- Code clarity and readability
- Security vulnerabilities
- Performance issues
- Test coverage
- Best practices
```

**Method 3: CLI Flag (Session-only)**
```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer",
    "prompt": "You are a senior code reviewer...",
    "tools": ["Read", "Grep", "Bash"],
    "model": "sonnet"
  }
}'
```

### Subagent Frontmatter Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | Unique identifier | `code-reviewer` |
| `description` | string | When Claude should delegate | "Reviews code for quality" |
| `tools` | list | Available tools | `[Read, Grep, Bash, Edit]` |
| `disallowedTools` | list | Tools to deny | `[Write, WebFetch]` |
| `model` | string | Model: `sonnet`, `opus`, `haiku`, `inherit` | `sonnet` |
| `permissionMode` | string | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` | `default` |
| `maxTurns` | number | Max agentic turns before stop | `20` |
| `skills` | list | Skills to preload | `[testing, linting]` |
| `memory` | string | Persistent memory: `user`, `project`, `local` | `user` |
| `background` | bool | Run as background task | `true` |
| `isolation` | string | `worktree` for git isolation | `worktree` |
| `hooks` | object | Lifecycle hooks | See hooks docs |

### Subagent Scope & Priority

Higher priority overrides lower:

1. **CLI flag** (`--agents`) - Session-only
2. **Project** (`.claude/agents/`) - Version-controlled
3. **User** (`~/.claude/agents/`) - Personal, all projects
4. **Plugin** - When plugin enabled

### Using Subagents

**Explicit delegation:**
```
Use the code-reviewer agent to review my recent changes
Have the test-runner agent run the test suite and fix failures
```

**Automatic delegation** (Claude decides based on description):
```
Explore the authentication module and summarize the architecture
```

**Resume subagent** (continue previous work):
```
Continue that code review and now analyze the authorization logic
```

### Subagent Execution Modes

**Foreground** (blocking):
- Main conversation waits for completion
- You can answer clarifying questions
- Better for iterative refinement

**Background** (concurrent):
- Subagent runs while you work
- Permission pre-approved upfront
- Better for long-running tasks
- Toggle with **Ctrl+B**

### Practical Subagent Examples

**Code Reviewer (Read-only):**
```markdown
---
name: code-reviewer
description: Reviews code for quality, security, and best practices
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer. When invoked:

1. Run `git diff` to see changes
2. Analyze modified files
3. Check for: clarity, security, performance, tests, best practices

Output:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider)

Include specific examples of fixes.
```

**Debugger (Can modify):**
```markdown
---
name: debugger
description: Debugs errors and test failures
tools: Read, Edit, Bash, Grep, Glob
---

You are an expert debugger. When invoked:

1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate failure location
4. Implement and verify fix
5. Document prevention steps
```

**Test Runner (Read + Execute):**
```markdown
---
name: test-runner
description: Runs tests and fixes failures
tools: Read, Edit, Bash
model: sonnet
---

Run the full test suite and fix any failures:

1. Run `npm test` or `cargo test`
2. Parse output for failures
3. Analyze failing tests
4. Implement fixes
5. Re-run to verify
```

### Subagent Memory

Enable persistent cross-session learning:

```yaml
---
name: code-reviewer
memory: user
---

As you review code, save patterns, conventions, and recurring issues to your memory.
```

**Memory scopes:**
- `user` - `~/.claude/agent-memory/<agent-name>/` (all projects)
- `project` - `.claude/agent-memory/<agent-name>/` (this project)
- `local` - `.claude/agent-memory-local/<agent-name>/` (personal, not shared)

Subagent automatically gets first 200 lines of `MEMORY.md` at startup.

### Agent Teams

For parallel work with communication between agents, use **agent teams** instead of subagents.

```
/agent-team
→ Create team with worker, researcher, reviewer agents
→ Assign tasks in parallel
→ Agents communicate and coordinate
```

Benefits:
- Each agent has own context window (no overhead)
- Agents can delegate to each other
- Better for large parallel tasks
- Automatic result synthesis

---

## 6. Memory System

Claude Code has two complementary memory mechanisms:

### CLAUDE.md Files

**User-written instructions** loaded at session start.

**Locations (priority):**
1. Managed policy: System-wide, non-overridable
2. Project: `./CLAUDE.md` or `./.claude/CLAUDE.md` (git)
3. User: `~/.claude/CLAUDE.md` (all projects)
4. Local: `./CLAUDE.local.md` (gitignored)

**Best Practices:**
- Keep under 200 lines (context efficiency)
- Be specific: "Use 2-space indentation" not "Format code"
- Use markdown headers to organize
- Include examples for ambiguous rules
- Check for conflicts across multiple CLAUDE.md files

**Example:**
```markdown
# Project Instructions

## Code Style
- 2-space indentation
- ESLint config in `.eslintrc.json`
- Run `npm run format` before commit

## Testing
- Run `npm test` before committing
- Minimum 80% coverage
- Test files in `__tests__/` directory

## Architecture
- API handlers in `src/api/handlers/`
- Services in `src/services/`
- Utilities in `src/utils/`

## Build & Deploy
- Build: `npm run build`
- Deploy: `npm run deploy:prod`
- Environment: See `.env.example`
```

### CLAUDE.md with Imports

Reference other files:
```markdown
# Project Instructions

See @README.md for overview and @package.json for available commands.

## Testing
More details at @docs/testing.md
```

Syntax: `@path/to/file` or `@~/home/file`

### .claude/rules/ Directory

Organize instructions by topic. Rules can be path-specific.

**Structure:**
```
.claude/rules/
├── code-style.md            # Unconditional
├── testing.md               # Unconditional
├── frontend/
│   └── react-conventions.md # Path-specific: src/**/*.tsx
└── backend/
    └── api-design.md        # Path-specific: src/api/**/*.ts
```

**Path-Specific Example:**
```markdown
---
paths:
  - "src/api/**/*.ts"
  - "src/handlers/**/*.ts"
---

# API Design Rules

- Use RESTful naming
- Return consistent error formats
- Include OpenAPI docs
```

Rules trigger when Claude edits matching files (lazy-load).

### Auto Memory

**System-generated** notes that Claude writes itself. Survives across sessions.

**Locations:** `~/.claude/projects/<project>/memory/`

**Files:**
- `MEMORY.md` - Index (first 200 lines loaded at startup)
- Topic files - `debugging.md`, `patterns.md`, etc. (loaded on demand)

**Claude saves:**
- Build commands that work
- Debugging insights and patterns
- Architecture decisions
- Code style preferences
- Workflow habits it discovers

**Toggle:** `/memory` → auto-memory toggle or in settings:
```json
{
  "autoMemoryEnabled": false
}
```

**View/Edit:** `/memory` opens memory folder in editor

### Memory Best Practices

1. **CLAUDE.md for rules** you enforce
2. **Auto-memory for learnings** Claude discovers
3. **Ask Claude to remember:** "Remember to always use pnpm"
4. **Keep CLAUDE.md under 200 lines** (context efficiency)
5. **Organize with .claude/rules/** for complex projects
6. **Use imports** for shared documentation
7. **Audit memory periodically** - ask Claude to review and clean up

---

## 7. Context Window Optimization

Claude Code's context window holds:
- Your conversation history
- File contents you reference
- Settings and memory files
- Tool call results
- System prompts

### Context Monitoring

**Check current usage:**
```
/context
```

Output shows:
- Tokens used / total (e.g., 45,280 / 200,000)
- Percentage (23%)
- Warnings if >90%

**Visual status in terminal:**
```
[Context: 45K / 200K (23%)]
```

### Context Efficiency Strategies

**1. Manage CLAUDE.md Size**
- Target: <200 lines
- Split large files using:
  - `@imports` (external files)
  - `.claude/rules/` (topic files)
  - Skills (task-specific instructions)

**2. Use Subagents for Large Operations**
- Isolate verbose output (test runs, log analysis)
- Subagent output summarized, stays in subagent context
- Main conversation stays clean

**3. Aggressive File Reference**
- Only reference files you're actively working on
- Don't dump entire repositories
- Use `Grep` to extract specific snippets
- Glob to find relevant files

**4. Invoke Skills Only When Needed**
- Skills loaded on-demand (not preloaded)
- Full skill content enters context only when invoked
- Better than adding instructions to CLAUDE.md

**5. Move Instructions to Skills**
- CLAUDE.md: "How we build and test"
- Skills: "How to deploy", "How to review PR"
- Skills invoked explicitly, don't consume context idle

**6. Use MCP Tool Search**
- Enabled automatically when MCP tools >10% of context
- `ENABLE_TOOL_SEARCH=auto:5` (5% threshold)
- MCP tools loaded on-demand, not upfront

**7. Hooks for Context Injection After Compaction**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Key reminders: Use Bun not npm. Run tests before commit.'"
          }
        ]
      }
    ]
  }
}
```

**8. Compact Conversations**
```
/compact
```

Summarizes conversation before the current point, freeing context.

**9. Pin Expensive Operations to Subagents**
```yaml
---
name: test-runner
description: Run test suite and report results
context: fork  # Runs in isolated context
---

Run `npm test` and summarize only the failures.
```

### Context Loading Order

Claude loads in this order:

1. **System prompt** (~500 tokens)
2. **Managed CLAUDE.md** (if configured)
3. **User CLAUDE.md** (~200 lines max)
4. **Project CLAUDE.md** (~200 lines max)
5. **Local CLAUDE.md** (~200 lines max)
6. **Lazy-loaded rules** (.claude/rules/ as needed)
7. **Auto-memory first 200 lines** (MEMORY.md)
8. **Skill descriptions** (not full content)
9. **MCP tool definitions** (or deferred if >10%)
10. **Conversation history** (oldest first)

---

## 8. Keyboard Shortcuts & Customization

### Default Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| **Enter** | Submit message | Chat |
| **Ctrl+C** | Interrupt/Cancel | Global |
| **Ctrl+D** | Exit Claude Code | Global |
| **Ctrl+T** | Toggle task list | Global |
| **Ctrl+O** | Toggle verbose transcript | Global |
| **Ctrl+R** | History search | Global |
| **Ctrl+G** | Open in external editor | Chat |
| **Ctrl+S** | Stash current prompt | Chat |
| **Ctrl+V** / **Alt+V** | Paste image | Chat |
| **Ctrl+P** / **Meta+P** | Open model picker | Chat |
| **Ctrl+T** / **Meta+T** | Toggle thinking mode | Chat |
| **Ctrl+\\** | Undo last action | Chat |
| **Shift+Tab** | Cycle permission modes | Chat |
| **Tab** | Accept autocomplete | Autocomplete |
| **Up/Down** | Navigate history | History |
| **Escape** | Dismiss menu | Various |
| **Ctrl+B** | Background task | Task |
| **?** | Help menu | Global |

### Customizing Keybindings

**File:** `~/.claude/keybindings.json`

**Generate:** Run `/keybindings` to create config

**Example:**
```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+e": "chat:externalEditor",
        "ctrl+shift+s": "chat:submit",
        "ctrl+u": null  // Unbind this
      }
    },
    {
      "context": "Global",
      "bindings": {
        "ctrl+alt+r": "app:toggleTranscript"
      }
    }
  ]
}
```

### Contexts

Each binding block specifies where shortcuts apply:

| Context | Where | Example |
|---------|-------|---------|
| `Global` | Everywhere | Exit, interrupt |
| `Chat` | Message input | Submit, edit |
| `Autocomplete` | Suggestion menu | Accept, dismiss |
| `Confirmation` | Permission dialogs | Confirm, deny |
| `Transcript` | History viewer | Exit, toggle content |
| `HistorySearch` | Ctrl+R menu | Next, accept |
| `Task` | Background task running | Background button |
| `Help` | Help menu visible | Dismiss |
| `Tabs` | Tab navigation | Next, previous |
| `Attachments` | Image attachment bar | Next, remove |
| `Footer` | Footer indicators | Open, navigate |
| `Select` | Generic list | Up, down, accept |
| `Plugin` | Plugin dialog | Toggle, install |
| `Settings` | Settings menu | Search, navigate |
| `ModelPicker` | Model selection | Increase/decrease effort |
| `DiffDialog` | Diff viewer | Next source, dismiss |

### Available Actions

**App Actions:**
```
app:interrupt        Ctrl+C - Cancel operation
app:exit            Ctrl+D - Exit Claude Code
app:toggleTodos     Ctrl+T - Toggle task list
app:toggleTranscript Ctrl+O - Toggle verbose output
```

**Chat Actions:**
```
chat:submit         Enter - Submit message
chat:cancel         Escape - Cancel input
chat:undo           Ctrl+\ - Undo
chat:externalEditor Ctrl+G - Open editor
chat:stash          Ctrl+S - Stash prompt
chat:modelPicker    Cmd+P - Model picker
chat:thinkingToggle Cmd+T - Extended thinking
```

**History Actions:**
```
history:search      Ctrl+R - History search
history:previous    Up - Previous item
history:next        Down - Next item
```

**Autocomplete Actions:**
```
autocomplete:accept     Tab - Accept
autocomplete:dismiss    Escape - Dismiss
autocomplete:previous   Up - Previous
autocomplete:next       Down - Next
```

### Keystroke Syntax

**Modifiers:**
```
ctrl, alt, shift, meta/cmd
```

**Combined:**
```
ctrl+k          - Control + K
shift+tab       - Shift + Tab
meta+p          - Command/Meta + P
ctrl+shift+c    - Multiple modifiers
```

**Chords (sequences):**
```
ctrl+k ctrl+s   - Press Ctrl+K, release, then Ctrl+S
```

**Special keys:**
```
escape, enter, tab, space
up, down, left, right
backspace, delete
```

**Uppercase implies Shift:**
```
K               - Shift+K
ctrl+K          - Just Ctrl+K (doesn't imply Shift)
```

### Example Customizations

**Vim-like Bindings:**
```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+h": null,
        "ctrl+j": null,
        "ctrl+k": null,
        "ctrl+l": null
      }
    },
    {
      "context": "Select",
      "bindings": {
        "j": "select:next",
        "k": "select:previous",
        "gg": "select:top",
        "G": "select:bottom"
      }
    }
  ]
}
```

**Emacs-like Bindings:**
```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+a": null,
        "ctrl+e": null,
        "meta+b": null,
        "meta+f": null
      }
    }
  ]
}
```

**Custom Workflow:**
```json
{
  "bindings": [
    {
      "context": "Global",
      "bindings": {
        "ctrl+alt+d": "app:toggleTodos",
        "ctrl+alt+t": "app:toggleTranscript"
      }
    },
    {
      "context": "Chat",
      "bindings": {
        "ctrl+enter": "chat:submit",
        "ctrl+l": "chat:externalEditor"
      }
    }
  ]
}
```

### Validate Keybindings

Run `/doctor` to check for:
- Parse errors
- Invalid context names
- Conflicts with reserved keys
- Terminal multiplexer conflicts
- Duplicate bindings

---

## 9. Model Selection & Performance

### Available Models

| Model | Speed | Cost | Capabilities | Best For |
|-------|-------|------|--------------|----------|
| **Opus 4.6** | Slower | Higher | Most capable, extended thinking | Complex reasoning, long-horizon tasks |
| **Sonnet 4.6** | Balanced | Medium | Very capable, balanced | Default choice, most tasks |
| **Haiku 4.5** | Fast | Low | Lightweight, good for routine tasks | Quick lookups, subagent work, cost-sensitive |

### Setting Model

**Default for session:**
```bash
claude --model sonnet   # Or opus, haiku
```

**In settings.json:**
```json
{
  "model": "sonnet"
}
```

**Per-subagent:**
```yaml
---
name: fast-reviewer
model: haiku        # Use cheaper model for this agent
---
```

### Fast Mode

Toggle faster output from current model:
```
/fast
```

**Key Facts:**
- Uses **Opus 4.6** with fast mode enabled
- Same capabilities, faster output
- Slightly higher cost per token
- Toggle any time during session

**When to use:**
- Complex reasoning needed
- Long response time acceptable
- Cost not a concern

**Environment variable:**
```bash
ENABLE_FAST_MODE=1 claude
```

### Model Aliases & Versions

Use human-readable aliases:
- `opus` → latest Claude Opus
- `sonnet` → latest Claude Sonnet
- `haiku` → latest Claude Haiku

For production/CI, pin specific versions:
```json
{
  "model": "claude-opus-4-6"
}
```

### Effort Levels

Control model behavior:
```
/effort
```

**Levels:**
- **Low** (fastest) - Quick answers
- **Medium** (default) - Balanced
- **High** (slower) - Deep thinking
- **Ultra** (slowest) - Extended thinking

### Extended Thinking (Opus/Sonnet)

Enable for complex problems:
```
/thinking
```

Or in skill:
```markdown
# Include "ultrathink" anywhere in content to enable thinking
For complex analysis, this skill uses extended thinking...
```

**When to use:**
- Difficult debugging
- Architecture decisions
- Complex refactoring
- Novel problems

---

## 10. IDE Integrations

### VS Code Extension

**Install:**
- Open VS Code
- Search "Claude Code" in extensions
- Click Install

**Features:**
- Prompt box with file references
- Resume past conversations
- Model picker (effort levels)
- View settings and keybindings
- Switch to terminal mode
- Manage plugins

**Configuration:** VS Code settings under `claude`

**Keyboard Shortcut:** `Cmd+Shift+C` (or configure)

### JetBrains IDEs

Supported: IntelliJ IDEA, PyCharm, WebStorm, CLion, etc.

**Install:**
- IDE → Settings → Plugins → Marketplace
- Search "Claude Code"
- Install and restart IDE

**Features:**
- Prompt from IDE context
- File references
- Model picker
- Settings access
- Work with WSL/remote development

**Configuration:** IDE → Settings → Tools → Claude Code

### Terminal Mode (CLI)

Run Claude Code from terminal:
```bash
claude
```

**Full-featured editor** with transcript, file preview, git integration.

### Remote Development

**SSH Sessions:**
```bash
claude --ssh user@host:/path/to/project
```

**WSL:**
```bash
claude --wsl ubuntu-22.04:/home/user/project
```

**Local Docker:**
Docker container with Claude Code pre-installed.

---

## 11. Plugins: Packaging & Distribution

### When to Use Plugins

Plugins bundle:
- **Skills** (reusable workflows)
- **Subagents** (specialized assistants)
- **Hooks** (lifecycle automation)
- **MCP servers** (external integrations)
- **LSP servers** (code intelligence)
- **Settings** (default configuration)

Best for:
- Distributing configurations to teams
- Packaging domain-specific tools
- Sharing across projects

### Plugin Structure

```
my-plugin/
├── plugin.json               # Required: plugin metadata
├── skills/
│   └── analyze/SKILL.md      # Skill definition
├── agents/
│   └── reviewer.md           # Subagent definition
├── hooks/hooks.json          # Hook configuration
├── mcp.json                  # MCP servers (or inline)
├── lsp.json                  # LSP servers
└── settings.json             # Default settings
```

### Plugin Metadata (plugin.json)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Custom tools for the team",
  "author": "Your Name",
  "license": "MIT",
  "skills": [
    "skills/analyze/SKILL.md"
  ],
  "agents": [
    "agents/reviewer.md"
  ],
  "hooks": "hooks/hooks.json",
  "mcpServers": {
    "internal-api": {
      "type": "http",
      "url": "https://api.internal.company.com/mcp"
    }
  }
}
```

### Installing Plugins

**From GitHub:**
```bash
claude plugin install github:username/plugin-name
```

**From Git URL:**
```bash
claude plugin install https://github.com/username/plugin-name.git
```

**From local path:**
```bash
claude plugin install ./path/to/plugin
```

### Plugin Scopes

| Scope | Location | When enabled | Sharing |
|-------|----------|--------------|---------|
| **Project** | `.claude/plugins.json` | This project | Via git |
| **User** | `~/.claude/plugins.json` | All projects | Personal |
| **Enterprise** | System-wide | All users | IT-deployed |

### Plugin Marketplace

Create a marketplace (`marketplace.json`) to distribute multiple plugins:

```json
{
  "name": "Company Tools",
  "version": "1.0.0",
  "plugins": [
    {
      "name": "database-tools",
      "source": "github:company/claude-db-tools"
    },
    {
      "name": "api-helpers",
      "source": "github:company/claude-api-helpers"
    }
  ]
}
```

Add marketplace:
```bash
claude plugin marketplace add https://github.com/company/claude-marketplaces
```

### Creating a Plugin

**Step 1: Create structure**
```bash
mkdir -p my-plugin/{skills,agents,mcp}
cd my-plugin
```

**Step 2: Write plugin.json**
```json
{
  "name": "code-tools",
  "version": "1.0.0",
  "description": "Analysis and review tools",
  "skills": ["skills/review/SKILL.md"],
  "agents": ["agents/debugger.md"]
}
```

**Step 3: Add skills & agents**

Create `skills/review/SKILL.md`:
```yaml
---
name: code-review
description: Review code for quality
allowed-tools: Read, Grep, Glob
---

Review this code for readability, performance, and best practices.
```

**Step 4: Push to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git push origin main
```

**Step 5: Share**
```
claude plugin install github:username/code-tools
```

---

## 12. Git Worktrees & Parallel Work

### Worktrees Overview

Git worktrees let Claude Code work on multiple branches simultaneously in isolated directories. Useful for:

- **Parallel feature branches** - Each agent/subagent in its own worktree
- **Isolation** - Changes don't affect other branches
- **Cleanup** - Automatic worktree removal

### Creating Worktrees

**Automatic (Claude creates on demand):**
```
/batch migrate src/ from Solid to React
```

Claude creates 5-30 worktrees automatically, spawns agents in parallel.

**Manual:**
```bash
claude --worktree feature/my-feature
```

### Worktree Cleanup

**Automatic:** Worktrees auto-cleanup when:
- Subagent finishes
- Session ends
- `/batch` completes

**Manual:**
```bash
/commit-commands:clean_gone
```

Removes all `[gone]` branches (deleted on remote but still local).

### Batch Workflow Example

```
/batch Add authentication to user signup

Research the codebase:
1. Find signup flow
2. Identify integration points
3. Plan changes

Decompose work:
- Add auth form validation
- Integrate with auth service
- Add error handling
- Write tests

Execute in parallel (Claude creates separate worktree + agent per unit)
Each agent:
1. Implements its unit
2. Tests locally
3. Creates PR
```

---

## 13. Scheduled Tasks

### Creating Scheduled Tasks

Create recurring tasks that run automatically:

```
/anthropic-skills:schedule
```

Or use the `/loop` skill:
```
/loop 5m check if deployment finished
```

Claude parses interval and schedules the task.

### Supported Intervals

- **Minutes:** `30m`, `5m`
- **Hours:** `1h`, `4h`
- **Days:** `1d`, `7d`
- **Cron syntax:** `0 9 * * 1` (9 AM Mondays)

### Use Cases

- Poll deployment status
- Periodic health checks
- Recurring reports
- Monitoring tasks
- Batch operations

---

## 14. Advanced Patterns & Best Practices

### 14.1 Context Management Strategy

**Tier 1: Global Instructions (CLAUDE.md)**
- Coding standards
- Architecture overview
- Project structure
- Build/test commands

**Tier 2: Lazy-Loaded Rules (.claude/rules/)**
- Path-specific conventions
- Detailed guidelines
- Loaded only when matching files opened

**Tier 3: Reusable Skills (.claude/skills/)**
- Specific workflows
- Task-driven instructions
- Invoked only when needed

**Tier 4: Subagent Context (Inline)**
- Task-specific prompts
- Specialized behavior
- Loaded per subagent

### 14.2 Permission Escalation Pattern

Use hooks for graduated permission checks:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/validate-edit.sh"
          }
        ]
      }
    ]
  }
}
```

Script (`./scripts/validate-edit.sh`):
```bash
#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path')

# Always allow tests
if [[ "$FILE" == *"test"* ]]; then exit 0; fi

# Warn on config files
if [[ "$FILE" == *"config"* ]]; then
  echo "Warning: Editing config file" >&2
  exit 0
fi

# Block sensitive files
if [[ "$FILE" == *".env"* ]] || [[ "$FILE" == *"secret"* ]]; then
  echo "Blocked: Sensitive file" >&2
  exit 2
fi

exit 0
```

### 14.3 Parallel Research Pattern

**Main conversation requests independent research:**
```
Research authentication, database, and payment modules in parallel using separate Explore agents.
Then synthesize findings.
```

**Each agent:**
- Gets copy of codebase
- Explores independently
- Returns summary to main conversation

**Benefits:**
- Faster than sequential research
- Exploration context stays isolated
- Main conversation stays clean

### 14.4 Progressive Disclosure Pattern

Start simple, add detail only as needed:

**User asks:** "Help me build an API"

**Claude:**
1. Asks clarifying questions
2. Proposes architecture
3. Implements endpoints incrementally
4. References `/api-conventions` skill when needed

**Benefits:**
- Conversation stays focused
- Skills load on-demand
- Context stays efficient
- User controls depth

### 14.5 Cost Optimization Strategies

**1. Route to Haiku when possible**
```yaml
---
name: explorer
model: haiku  # Cheap, fast
---
```

**2. Use subagents for verbose output**
```
Use a subagent to run tests and report only failures
```

**3. Compress instructions with .claude/rules/**
- Split 500-line CLAUDE.md into 5 x 100-line rules
- Rules load only when needed
- Saves context for active conversation

**4. Use fast mode for simple tasks**
```
/fast
```

**5. Lazy-load skills (don't preload)**
- Skills loaded only when invoked
- Not in context when idle

### 14.6 Team Collaboration Patterns

**Shared .claude/ directory:**
```
.claude/
├── CLAUDE.md           # Team standards (checked in)
├── rules/
│   ├── code-style.md
│   ├── testing.md
│   └── security.md
├── skills/             # Shared workflows
│   ├── code-review/
│   └── deploy/
├── agents/             # Shared subagents
│   └── reviewer.md
└── settings.json       # Team defaults
```

**Personal overrides:**
```
.claude/settings.local.json   # Personal, gitignored
```

**Resolve conflicts:**
```json
{
  "claudeMdExcludes": [
    "**/other-team/.claude/**"
  ]
}
```

### 14.7 Monorepo Patterns

**Project structure:**
```
monorepo/
├── CLAUDE.md              # Root: shared standards
├── packages/
│   ├── backend/
│   │   ├── .claude/
│   │   │   ├── CLAUDE.md  # Backend-specific
│   │   │   └── skills/
│   │   └── src/
│   └── frontend/
│       ├── .claude/
│       │   ├── CLAUDE.md  # Frontend-specific
│       │   └── rules/
│       └── src/
```

**In subdirectory:**
```
cd packages/backend
claude  # Loads root CLAUDE.md + backend CLAUDE.md (backend wins)
```

### 14.8 CI/CD Integration

**GitHub Actions:**
```yaml
name: Claude Code Review

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: anthropics/claude-code-action@v1
        with:
          prompt: "Review this PR and suggest improvements"
          model: sonnet
```

**GitLab CI:**
```yaml
claude-review:
  script:
    - claude "Review changes in this MR and add comments"
```

### 14.9 Session Persistence

**Save session for later:**
```bash
claude --session my-session-name
```

**Resume session:**
```bash
claude --session my-session-name
```

**List sessions:**
```bash
claude sessions list
```

**Archive old sessions:**
```
/archive
```

### 14.10 Debugging Hooks

Enable verbose hook logging:

```bash
claude --debug   # Full execution details including hooks
```

Or toggle in session:
```
Ctrl+O  # Toggle transcript (shows hook output)
/hooks  # View all hooks
```

---

## Summary & Quick Reference

### Essential Commands

| Command | Purpose |
|---------|---------|
| `/status` | Check settings, context, active hooks |
| `/memory` | View CLAUDE.md and auto-memory files |
| `/hooks` | Interactive hook configuration |
| `/agents` | Create and manage subagents |
| `/mcp` | Connect and authenticate MCP servers |
| `/keybindings` | Customize keyboard shortcuts |
| `/context` | View current context usage |
| `/compact` | Summarize and free context |
| `/fast` | Toggle fast mode |
| `/effort` | Adjust model effort level |
| `/thinking` | Toggle extended thinking |
| `/plugin` | Install and manage plugins |
| `/simplify` | Review and optimize code |
| `/batch` | Parallel changes across worktrees |
| `/debug` | Troubleshoot session |
| `/loop` | Schedule recurring tasks |

### File Locations

| File | Location | Scope | Purpose |
|------|----------|-------|---------|
| `settings.json` | `~/.claude/` | User | Global configuration |
| `settings.json` | `.claude/` | Project | Team configuration |
| `settings.local.json` | `.claude/` | Local | Personal overrides |
| `CLAUDE.md` | `~/.claude/` | User | Personal instructions |
| `CLAUDE.md` | Project root | Project | Team instructions |
| `CLAUDE.local.md` | Project root | Local | Personal project notes |
| `.claude/rules/` | Project | Project | Path-specific rules |
| `.claude/skills/` | Project | Project | Reusable workflows |
| `.claude/agents/` | Project | Project | Subagent definitions |
| `.mcp.json` | Project | Project | MCP server configs |
| `keybindings.json` | `~/.claude/` | User | Keyboard shortcuts |
| `~/.claude.json` | Home | User | Cached credentials (auto) |

### Context Efficiency Checklist

- [ ] CLAUDE.md under 200 lines
- [ ] Use `.claude/rules/` for path-specific rules
- [ ] Move task-specific instructions to skills
- [ ] Use subagents for large output operations
- [ ] Enable MCP tool search if >10 tools configured
- [ ] Run `/context` regularly to monitor usage
- [ ] Use `/compact` when approaching 90%
- [ ] Lazy-load skills, don't preload
- [ ] Use Haiku subagents for routine work

---

## Additional Resources

- **Official Claude Code Docs:** https://code.claude.com/docs/
- **Claude Agent SDK:** https://platform.claude.com/docs/en/agent-sdk
- **MCP Registry:** https://github.com/modelcontextprotocol/servers
- **Agent Skills Standard:** https://agentskills.io

---

**Document Version:** 1.0  
**Last Updated:** March 7, 2026  
**Scope:** Charlie's Claude Code Efficiency Maximization

---

## Charlie's Top Priority Upgrades

Based on your current setup (plugins: superpowers, coderabbit, code-simplifier, matlab-skills, ralph-loop, commit-commands, feature-dev, hookify; MCP: Chrome, Context7, MATLAB, Preview, Scheduled Tasks):

### 1. Move hardware details to `.claude/rules/`
Your CLAUDE.md is good but could be leaner. Move ESP-specific patterns to lazy-loaded rules that only trigger when editing `.ino` or `.h` files.

### 2. Create hardware safety hooks
Add PreToolUse hooks to validate OTA uploads, prevent accidental USB uploads, and catch common ESP8266 pitfalls before they reach hardware.

### 3. Use Haiku subagents for routine work
Route compilation checks, log analysis, and code formatting to Haiku subagents. Save Opus for architecture decisions and complex debugging.

### 4. Create project-specific skills
- `/deploy-clock` - Compile + OTA upload in one command
- `/hub-start` - Start Hub with device health check
- `/firmware-review` - Pre-upload code review

### 5. Set up scheduled health checks
Use the Scheduled Tasks MCP to poll the clock's `/api/status` every 15 minutes and alert on anomalies.