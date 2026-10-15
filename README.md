# Veave — AI-Powered UI Generation Platform

Build interfaces with AI. Describe what you want, get a working React application, iterate with an AI agent, and export your code.

## Architecture

```
User Browser → React Frontend (:5173) → Express Backend (:5000) → OpenRouter API
                                              ↓
                                           MongoDB
```

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- OpenRouter API key ([openrouter.ai](https://openrouter.ai))

### 1. Clone & Install

```bash
# Backend
cd backend
cp .env.example .env
# Edit .env with your MongoDB URI, JWT secret, and OpenRouter API key
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure Environment

Edit `backend/.env`:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/veave
JWT_SECRET=your_secure_random_secret_here
JWT_REFRESH_SECRET=your_secure_random_refresh_secret_here
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=anthropic/claude-sonnet-4
CLIENT_URL=http://localhost:5173
```

### 3. Run

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Features

- **AI UI Generation** — Describe a UI in natural language and get working React code
- **Generation Validation & Self-Repair** — Install, build, execute, browser-test, and repair candidate revisions before saving them
- **Live Preview** — See your generated application rendered in real-time
- **AI Agent** — Iteratively modify your UI through conversational AI
- **Code Editor** — Monaco-powered editor with syntax highlighting
- **File Explorer** — Browse and manage generated files
- **Version History** — Snapshot and restore previous versions
- **Export** — Download a complete, runnable React + Vite project
- **Auth** — Secure user accounts with JWT authentication

### Generation validation and recovery

Website prompt jobs now keep candidate files separate from the saved project until this gate passes:

```text
Generate -> static validation -> install/verify dependencies -> type check
  -> real npm run build -> production preview startup -> Chromium desktop/mobile
  -> route/control smoke tests -> verified artifact -> save/complete
                         |
                  diagnostics + history
                         |
                 focused repair (max 2)
                         |
                 repeat the whole gate
```

The direct generation, modification, screenshot and agent file-action endpoints use the same gate. Failed candidates do not replace the previous working project. Jobs retain stage, attempt history, diagnostics, changed paths and coverage in `validation`; status is `blocked` when execution infrastructure or an external integration is unavailable, not `completed`. Cancellation terminates active worker containers. Export preserves the tested manifest and lockfile.

**Runner setup (required):** install/start Docker with Linux containers, then run `npm run runner:build` from `backend`. The backend uses image `veave-validator:1` by default (`VEAVE_RUNNER_IMAGE` overrides it). No generated scripts run on the backend host. The install container has no credentials, disallows non-registry dependency specs and disables dependency lifecycle scripts. Its internal network can reach only a registry-only CONNECT proxy for downloads. A separate network-disabled container runs the real build including its pre/post hooks, preview server and Chromium, with CPU/memory/PID/time limits. Use a dedicated runner host and additional infrastructure-level resource/egress policies for production multi-tenant deployments. When dependency declarations change, npm updates the lockfile in isolation before `npm ci`; unchanged projects reuse their tested lockfile.

**Preview hosting:** verified build artifacts are served on a separate hostname and expire after seven days. Locally this is `http://{token}.localhost:5000` (or backend `PORT`). Production requires `VEAVE_PREVIEW_ORIGIN=https://{token}.preview.example.com`, wildcard DNS/TLS and proxy routing to the backend. Never use the studio's own origin. The preview host only serves artifacts and does not expose backend APIs. The studio verifies the source hash before choosing this built preview. Manual edits and old projects remain explicitly labeled unverified until validated again; the visual design editor retains its legacy editable renderer.

**Scope:** the runner supports single-package React/Vite-style projects with real `build`/`preview` npm scripts and `dist/index.html`. Chromium checks uncaught errors, console errors, missing assets/failed requests, visible content, discovered routes, and up to 12 controls per viewport. This is bounded smoke coverage, not a guarantee of all business behavior. Add `veave.validation.json` selector/action/assertion scenarios for critical ordered workflows; repairs cannot weaken existing scenarios. See [runner documentation](backend/runner/README.md).

External API calls and remote assets are blocked during browser validation and reported as unmet integration requirements, not silently mocked or removed. Use bundled assets/system fonts and explicitly configured local API fixtures. Live provider credentials and a supported provider model are required for AI generation/repair. The pipeline never labels missing Docker, Chromium, dependencies or API infrastructure as success.

**Tests:** from `backend`, run `npx playwright install chromium` once, then `npm test`. `npm run test:runner` exercises a real container build, click-only crash, repair and rebuild using deterministic fixtures; it requires Docker and the built runner image and fails explicitly when unavailable. From `frontend`, run `npm run validate`.

## Tech Stack

| Layer      | Technology                                    |
|------------|-----------------------------------------------|
| Frontend   | React 18, Vite, Tailwind CSS, Zustand, Monaco |
| Backend    | Express.js, Mongoose, JWT                     |
| Database   | MongoDB                                       |
| AI         | OpenRouter (Claude, GPT, etc.)                |
| Preview    | Validated Vite artifacts on isolated hosts; legacy editable iframe for unverified files |

## API Endpoints

| Method | Endpoint                              | Description              |
|--------|---------------------------------------|--------------------------|
| POST   | `/api/auth/register`                  | Register user            |
| POST   | `/api/auth/login`                     | Login                    |
| POST   | `/api/auth/logout`                    | Logout                   |
| GET    | `/api/auth/profile`                   | Get user profile         |
| GET    | `/api/projects`                       | List projects            |
| POST   | `/api/projects`                       | Create project           |
| GET    | `/api/projects/:id`                   | Get project              |
| PATCH  | `/api/projects/:id`                   | Update project           |
| DELETE | `/api/projects/:id`                   | Delete project           |
| GET    | `/api/projects/:id/files`             | Get project files        |
| PATCH  | `/api/projects/:id/files`             | Update project file      |
| GET    | `/api/projects/:id/export`            | Export project as ZIP     |
| POST   | `/api/agent/:projectId`               | Send message to AI agent |
| GET    | `/api/history/projects/:id/history`   | Get version history      |
| POST   | `/api/history/projects/:id/restore/:v`| Restore version          |
| GET    | `/api/usage`                          | Get AI usage             |
| GET    | `/api/usage/summary`                  | Get usage summary        |

## Project Structure

```
veave/
├── backend/
│   ├── src/
│   │   ├── config/          # DB & CORS config
│   │   ├── controllers/     # Route handlers
│   │   ├── middleware/       # Auth, validation, rate limiting
│   │   ├── models/          # Mongoose schemas
│   │   ├── routes/          # Express routes
│   │   ├── services/        # Business logic
│   │   │   ├── ai/          # OpenRouter, prompts, context
│   │   │   ├── agent/       # Agent orchestrator
│   │   │   └── project/     # Project & file management
│   │   ├── utils/           # Helpers, errors, logger
│   │   ├── app.js           # Express app setup
│   │   └── server.js        # Entry point
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── features/        # Feature modules
│   │   │   ├── agent/       # AI chat panel
│   │   │   ├── editor/      # Code editor, file explorer
│   │   │   ├── preview/     # Live preview frame
│   │   │   ├── projects/    # Project cards, grid
│   │   │   └── authentication/
│   │   ├── hooks/           # Custom hooks
│   │   ├── layouts/         # App, Auth, Editor layouts
│   │   ├── pages/           # Page components
│   │   ├── services/        # API services
│   │   ├── store/           # Zustand stores
│   │   └── utils/           # Helpers, constants
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## License

MIT
