# PersonalFlix

A private, single-user streaming app for a movie and TV library kept in Google Drive. It runs entirely on free tiers, and video never passes through a server.

## How it works

```text
Drive: MOVIE/ + SERIES/ (originals, never modified)
   │  Colab notebook (one-off batch): remux/re-encode → one H.264 video file + one AAC file per audio language,
   │  packaged as DASH with MP4Box, uploaded as the org account
   ▼
Drive: STREAM/…mp4 files + STREAM/library.json (catalog: title, episode, duration, audio languages, DASH manifest)
   │
   │  "Sync library" button → POST /api/library/refresh copies library.json into Postgres
   ▼                          and adds TMDB posters/backdrops/overviews
Next.js on Vercel (pages + tiny JSON calls only) ── Neon Postgres (catalog, TMDB metadata, watch progress)
   │
   │  /api/token → short-lived drive.readonly token from the "PersonalFlix Read" Apps Script
   ▼
Browser: Shaka Player streams the DASH manifest straight from Drive (Authorization header),
         switches audio language in place, and saves progress back to Postgres
```

- **Browsers:** Firefox and Edge on Windows and Android. Video is always 8-bit H.264 and audio is AAC.
- **Audio languages:** every language is a separate DASH track, so switching keeps your position.
- **No Google Cloud Console needed:** the org account's token comes from an Apps Script web app that runs as that account (`apps-script/`).

## Features

- "Screening Room" UI: filmstrip hero, Up Next row (a finished episode rolls on to the next one), library grid with filters and sorting, title sheet with season tabs, and Ctrl K / `/` search across titles and episodes
- Player: resume prompt, audio-language menu (<kbd>A</kbd> cycles), speed, next-episode countdown, episode drawer, double-tap seek on touch, picture-in-picture, Media Session keys, and the full keyboard set (<kbd>?</kbd> in the player)
- `/tmdb-config`: fix wrong TMDB matches and turn on per-series episode names and stills

## Setup

1. **Apps Script (as the org account).** Create a project from `apps-script/Code.gs` and `apps-script/appsscript.json`. Add a script property `PASSPHRASE`, run `authorize` once, then deploy it as a web app (Execute as: *Me*, access: *Anyone*). Keep the `/exec` URL.
2. **Convert the library.** Run the Colab convert notebook. It prints the `library.json` file ID at the end.
3. **Environment.** Copy `frontend/.env.example` to `frontend/.env.local` (and to the Vercel project settings) and fill it in.
4. **Database.**
   ```bash
   cd frontend
   npm install
   npx prisma db push
   ```
5. **Run.** `npm run dev`, sign in, and press **Sync library** (the status pill in the top bar).

After each notebook run, press **Sync library** again. Titles that aren't converted yet stay hidden until they are.

## Adding titles (`/upload`)

1. **Upload.** Open `/upload` (the upload icon in the top bar). Drop movie files or whole series folders, from a PC or a phone. Names are cleaned up from the release names and checked against TMDB, and you can edit any of them. Files are then uploaded **from the browser straight into Drive**, in resumable chunks, and saved as `MOVIE/Title-2021/Title-2021.mkv` or `SERIES/Show - 2005/Season 01/Show - S01E05.mkv`. Vercel only opens the upload session. A title or episode that already exists asks before replacing it; the old file goes to Drive's bin.
2. **Convert.** Run the convert notebook with `MODE = all`. It converts whatever isn't in `library.json` yet and skips the rest.
3. **Stream.** Fill in `SYNC_URL` in the notebook and add a `SYNC_SECRET` Colab secret that matches the app's env. The app then syncs itself when the run ends. Otherwise press **Sync**.

Needs `DRIVE_WRITE_URL` / `DRIVE_WRITE_PASSPHRASE` (the "PersonalFlix Write" Apps Script) in the app's env.

## Tech

Next.js 14 (App Router) · Shaka Player (DASH) · Prisma + Neon Postgres · Clerk · TMDB / OMDb · Google Apps Script · Colab + FFmpeg + MP4Box
