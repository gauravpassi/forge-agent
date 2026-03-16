# Forge Agent

Multi-agent development platform for the AgenticAI project.

## Architecture
User → Forge Orchestrator → Sub-Agents (Coding, Deployment, Planning, Testing, Docs) → Shared Knowledge Base

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy env file and add your API key:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your `ANTHROPIC_API_KEY`

4. Start Forge:
   ```bash
   npm start
   ```

## Usage

Type natural language commands:
- `"Fix the GADSL page build error"`
- `"Add a new agent template for healthcare"`
- `"Commit and deploy the latest changes"`
- `"What agents are in the education hub?"`

## Agents

| Agent | Purpose | Tools |
|-------|---------|-------|
| Coding | Write, edit, create files | file read/write/edit, glob, grep |
| Deployment | Git commit, push, deploy | git, bash |
| Planning | Feature breakdown, roadmaps | file read, kb |
| Testing | Run builds, validate | bash, file |
| Docs | Documentation, changelogs | file read/write, kb |
| Query | Answer codebase questions | file read, kb |
