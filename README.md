# Hotwills Collaborative Catalog (GitHub Pages + Supabase)

Static multiuser catalog for the Yesteryear dataset.

- Frontend: static files (`index.html`, `css/*`, `js/*`) for GitHub Pages
- Auth + DB + Realtime + Storage: Supabase
- Source parser: downloads upstream `data.json` and all model images

UI modes:
- Catalog
- Editor
- Infographic
- Statistics (modal from header)

The UI is based on the original yesteryear layout, with cloud auth/sync added.

Current header UX:
- Large header with quick metrics (models, codes, years, overlaps)
- `Statistics` button opens detailed analytics and catalog comparison
- Account menu (`👤`) includes auth actions and catalog owner selector

## How to use (current flow)

1. Sign in with Google from account menu (`👤 -> Авторизация`).
2. Load a local import folder with `Загрузить папку`.
3. Edit models in `Editor` mode if needed.
4. Save with `Сохранить в облако`.
5. Switch owner in `Каталог` selector to browse another user's catalog (always read-only for non-owner catalogs).

Important cloud behavior:
- `Сохранить в облако` performs a full replace of your catalog rows in Supabase.
- Old rows are deleted and replaced by current editor state.
- Stale files in your user storage folder (`model-images/<your-uid>/...`) are also cleaned up.
- Button/status show save progress while preparing/uploading images.

## 1. Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `/Users/dmitry/Project/hotwills/supabase/schema.sql`.
3. In Supabase Auth settings, optionally disable email confirmation for quick testing.
4. Copy project URL and anon key.
5. Edit `/Users/dmitry/Project/hotwills/config.js`:

```js
window.HOTWILLS_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  imageBucket: "model-images"
};
```

### Google OAuth setup

1. In Google Cloud Console, create OAuth 2.0 Client ID (`Web application`).
2. In Google OAuth client, set authorized redirect URI:
`https://mxteotlrohorkqvwdxmo.supabase.co/auth/v1/callback`
3. In Supabase Dashboard:
- `Authentication -> Providers -> Google`: enable provider, paste Google client ID/secret.
- `Authentication -> URL Configuration`: set Site URL to `https://dmitry-dev-pet.github.io/hotwills/`.
- Add redirect URLs:
`https://dmitry-dev-pet.github.io/hotwills/`
`http://localhost:8080/`

## 2. Install dependencies

```bash
cd /Users/dmitry/Project/hotwills
npm install
```

## 3. Parse source data + images

```bash
npm run fetch:source
```

This saves:
- `/Users/dmitry/Project/hotwills/data/source/data.json`
- `/Users/dmitry/Project/hotwills/data/source/images/*`
- `/Users/dmitry/Project/hotwills/data/source/manifest.json`

Folder import expectations in UI (`Загрузить папку`):
- Folder must include one JSON file (preferably `data.json`).
- Any image files in the selected folder tree are imported into local IndexedDB.
- JSON `image` values should reference filenames (example: `46.webp` or `2.jpg`).
- Filenames should be unique; path segments are not used as identity keys.

## 4. Import into Supabase

Use service role key only from terminal (never in frontend):

```bash
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
npm run upload:supabase
```

## Local Nano Banana stylization (via cliproxyapi)

Build a new local import pack (`data/stylized-pack`) in the same format (`data.json` + `images/*`):

```bash
CLIPROXY_KEY="YOUR_CLIPROXY_KEY" \
CLIPROXY_MODEL="nanobanana" \
npm run stylize:nanobanana
```

Optional flags:

```bash
npm run stylize:nanobanana -- \
  --pack-dir data/source \
  --out-dir data/stylized-pack \
  --concurrency 2 \
  --limit 20
```

Notes:
- Endpoint defaults to `http://127.0.0.1:8317` (override with `CLIPROXY_ENDPOINT`).
- If stylization fails for an image, original file is copied by default (can be disabled with `--no-fallback`).
- Import the resulting folder in UI with `Загрузить папку`.
- Typical resulting pack format: `<pack>/data.json` and `<pack>/images/*`.

## 5. Run locally (optional)

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## 6. Deploy to GitHub Pages

Push repository and enable Pages for the default branch/root.

## 7. GitHub Actions automation

This repo includes two workflows:

- `/Users/dmitry/Project/hotwills/.github/workflows/supabase-sync.yml`
- `/Users/dmitry/Project/hotwills/.github/workflows/deploy-pages.yml`

### Required GitHub secrets

For Supabase sync workflow:

- `SUPABASE_URL` (example: `https://YOUR_PROJECT_REF.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side key; keep secret)

### Recommended GitHub repository variables

For Pages deploy workflow (to generate `config.js` on CI):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

If variables are not set, deploy still works but uses committed `config.js`.

### Schedules

- `Sync Source To Supabase` runs daily at `03:00 UTC` and can be started manually.
- `Deploy GitHub Pages` runs on pushes to `main` and can be started manually.

## Multiuser model

- Catalog rows are public-read (`SELECT`) by RLS policy.
- Only authenticated owner can insert/update/delete own rows (`created_by = auth.uid()`).
- New rows are inserted with `created_by = auth.uid()`.
- Storage object keys are user-scoped (`<auth.uid()>/...`).
- Owner labels in UI come from `public.user_profiles` (`email`).
- Another user's catalog can be opened from account menu (`Каталог` selector) and is always read-only in the app.
- Stats modal supports comparison with another owner from the same owner list.

## Realtime note

If you see browser warning like:
- `WebSocket connection ... realtime/v1/websocket ... closed before the connection is established`

This usually means Realtime is disabled or blocked in current environment. Core catalog load/save still works without Realtime subscription.
