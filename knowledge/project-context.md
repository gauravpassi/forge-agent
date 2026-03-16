# AgenticAI Project Context

## Project Path
/Users/gauravpassi/Desktop/AgenticAI/agenticai-demo

## Tech Stack
Next.js 15, TypeScript, Tailwind CSS v4, Anthropic SDK, shadcn/ui

## Key Directories
- src/app/templates/ — 48+ agent template pages
- src/app/api/agents/ — Backend API routes (streaming SSE)
- src/lib/ — Utilities, constants, helpers
- src/components/ — UI components

## Patterns
- Each agent = 1 page.tsx + 1 route.ts
- All agents use streaming SSE via createStreamResponse()
- Dark theme: zinc-950/900/800 backgrounds

## Deployment
- GitHub: https://github.com/gauravpassi/agenticai-demo
- Vercel: https://agenticai-demo-olive.vercel.app
- Auto-deploys on push to main
