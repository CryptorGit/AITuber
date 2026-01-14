# Movie Pipeline (Production)

This folder contains the production-ready movie-pipeline implementation for replay ? script ? TTS ? overlay ? final MP4.

## Structure
- `apps/movie-pipeline/core` Core pipeline + adapters + job runner
- `apps/movie-pipeline/server` API server (Express)
- `apps/movie-pipeline/cli` CLI entrypoints
- `web/movie-pipeline` Web UI (Vite + React)

## Requirements
- Node.js 18+
- ffmpeg + ffprobe in PATH
- Google Cloud Text-to-Speech enabled (ADC via `GOOGLE_APPLICATION_CREDENTIALS` or gcloud)
- (Optional) VOICEVOX engine running locally (default: `http://127.0.0.1:50021`)
- Playwright (installed via core package)

## Data layout
- Replays: `data/movie-pipeline/replays/{battle_id}/replay.mp4` (or any `.mp4`)
- Logs: `data/movie-pipeline/replays/{battle_id}/battle_log.json|jsonl|txt`
- Timestamps: `data/movie-pipeline/replays/{battle_id}/ts_log.json` (optional but recommended)
- BGM: `data/movie-pipeline/bgm/*.mp3`
- Characters: `data/movie-pipeline/characters/{character_id}/character.json`

### character.json example
```json
{
  "character_id": "sample",
  "name": "Sample Avatar",
  "renderer": "simple_canvas",
  "avatar": {
    "body_color": "#222222",
    "accent_color": "#ff7a59",
    "mouth_color": "#ffffff"
  },
  "chroma_key": "#00ff00",
  "width": 720,
  "height": 720,
  "fps": 30
}
```

## Setup
```bash
cd apps/movie-pipeline/core
npm install

cd ../server
npm install

cd ../cli
npm install

cd ../../web/movie-pipeline
npm install
```

## Run (server + UI)
```bash
# Terminal 1
cd apps/movie-pipeline/server
npm run dev

# Terminal 2
cd web/movie-pipeline
npm run dev
```

Open `http://127.0.0.1:5175`.

## CLI
```bash
cd apps/movie-pipeline/cli

# Scan assets
npm run start -- scan

# Create a project
npm run start -- create --battle-id <battle_id> --bgm <bgm.mp3> --character <character_id>

# Run all steps
npm run start -- run --project-id <project_id> --step all

# Force rerun
npm run start -- run --project-id <project_id> --step all --force

# Doctor
npm run start -- doctor

# Generate sample data under data/movie-pipeline/replays
npm run start -- sample --battle-id sample_demo
```

## Tests
```bash
cd apps/movie-pipeline/core
npm run test
```

## API (server)
- `GET /api/mp/assets` ? assets + bgm + characters
- `GET /api/mp/projects` ? list projects
- `POST /api/mp/projects` ? create project
- `PATCH /api/mp/projects/:id` ? update settings
- `POST /api/mp/projects/:id/script` ? update script.json
- `POST /api/mp/projects/:id/run?step=ladm|tts|live2d|compose|all&force=true` ? run
- `GET /api/mp/projects/:id` ? project
- `GET /api/mp/projects/:id/runs` ? run history
- `GET /api/mp/projects/:id/runs/:runId` ? run detail
- `GET /api/mp/projects/:id/logs/:step?run_id=...` ? step log tail
- `GET /api/mp/doctor` ? dependency check
- `GET /api/mp/voices?language_code=ja-JP` ? google tts voices

## Outputs
Each project writes to `data/movie-pipeline/projects/{project_id}/artifacts/`:
- `script.json` (LADM draft)
- `subtitles.draft.srt`
- `tts.wav`, `tts.mp3`, `tts_timing.json`
- `script_timed.json`, `subtitles.srt`, `subtitles.ass`
- `overlay.webm`, `lip_sync.json`
- `final.mp4`, `final_with_subs.mp4`
- `manifest.json`

Run logs are stored per run: `data/movie-pipeline/projects/{project_id}/runs/{run_id}/steps/*.log`.

## Troubleshooting
- `Google TTS error`: ensure ADC is configured and the Text-to-Speech API is enabled.
- `VOICEVOX unavailable`: start the VOICEVOX engine (default port 50021) and switch provider to voicevox.
- `ffmpeg not found`: install ffmpeg/ffprobe and ensure they are on PATH.
- `playwright missing`: `npm install` in `apps/movie-pipeline/core` and run `npx playwright install chromium` if needed.

## Environment overrides
- `MP_DATA_ROOT` ? override `data/movie-pipeline`
- `MP_ASSETS_ROOT` ? override `data/movie-pipeline/replays`
- `MP_BGM_ROOT` ? override `data/movie-pipeline/bgm` (e.g. point at a folder under `tools/`)
- `MP_CHARACTERS_ROOT` ? override `data/movie-pipeline/characters`
- `MP_PORT` ? server port
- `VITE_MP_API_BASE` ? UI API base
