# Hotwills Collaborative Catalog (GitHub Pages + Supabase)

Static multiuser catalog for the Yesteryear dataset.

- Frontend: static files (`index.html`, `css/*`, `js/*`) for GitHub Pages
- Auth + DB + Realtime + Storage: Supabase
- Source parser: downloads upstream `data.json` and all model images

UI modes:
- Catalog
- Editor
- Infographic

The UI is based on the original yesteryear layout, with cloud auth/sync added.

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

## 4. Import into Supabase

Use service role key only from terminal (never in frontend):

```bash
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
npm run upload:supabase
```

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

- Each authenticated user can read any catalog rows (for shared viewing).
- Each authenticated user can update/delete only own rows.
- New rows are inserted with `created_by = auth.uid()`.
- Storage object keys are user-scoped (`<auth.uid()>/...`).
- Another user's catalog can be opened from the account menu (`Каталог` selector) even without login, always in read-only mode.
