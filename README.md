# Personal Netflix (PersonalFlix)

A beautiful, self-hosted streaming platform inspired by Netflix. Rather than paying for streaming services or dealing with complex media servers like Plex/Jellyfin, **PersonalFlix** connects directly to your Google Drive to stream your personal library of Movies and TV Shows. 

It automatically scans your Google Drive folders, fetches rich metadata (posters, backdrops, episode plots) from TMDB and OMDb, and provides a premium, responsive UI for playback with cross-device watch progress tracking.

## ✨ Features

- **Google Drive Integration**: Uses the Google Drive API to stream video files directly. No need to download heavy video files or maintain a dedicated media server PC.
- **Intelligent Metadata Matching**: Automatically queries both **TMDB** and **OMDb** to populate high-resolution posters, backdrops, ratings, and episode synopses based on your folder and file names.
- **Progress Tracking & "Continue Watching"**: Automatically tracks watch progress per user, remembering exactly where you left off in an episode or movie.
- **Custom Video Player**: A custom-built, responsive HTML5 video player featuring +/- 10s skips, volume memory, seamless Media Session API integration (hardware media keys), full-screen mode, and cross-browser support.
- **Modern Tech Stack**: Built with Next.js 14 App Router, styled with Tailwind CSS, and powered by server-side React components for blazing-fast performance.
- **Secure Authentication**: Integrated with Clerk for seamless, secure user management.

## 🛠️ Tech Stack

- **Framework:** Next.js 14 (React)
- **Styling:** Tailwind CSS, Lucide Icons
- **Database:** PostgreSQL (Neon Serverless)
- **ORM:** Prisma
- **Auth:** Clerk
- **APIs:** Google Drive API v3, TMDB API, OMDb API

## 📂 Google Drive Folder Structure

To ensure the scanner works correctly, your Google Drive root folder must be structured as follows:

```text
MAIN_DRIVE_FOLDER/
  ├─ Movies/
  │   ├─ Inception (2010)/
  │   │   └─ inception2010.mp4
  │   └─ The Dark Knight/
  │       └─ dark_knight.mkv
  └─ Series/
      └─ The Rookie/
          ├─ Season 1/
          │   ├─ therookie-S01E01.mkv
          │   └─ therookie-S01E02.mkv
          └─ Season 2/
              └─ therookie-S02E01.mkv
```

1. **Top-Level Categories**: e.g., `Movies`, `Series`, `Anime`
2. **Title Folders**: Placed directly inside the category. Add the release year e.g. `(2010)` to improve TMDB matching accuracy.
3. **Seasons (Series Only)**: Folders named `Season 1`, `Season 02`, etc.
4. **Episodes/Files**: The actual video files securely hosted in Google Drive. 

## 🚀 Local Setup

### 1. Prerequisites
- Node.js 18+
- A Google Cloud Platform project with the Drive API enabled & a Service Account JSON.
- A free PostgreSQL database (e.g., Neon or Supabase).
- API Keys for TMDB, OMDb, and Clerk.

### 2. Environment Variables
Create a `.env.local` (and add your DB url to `.env` for Prisma). Use `.env.example` as a template and fill in:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` & `CLERK_SECRET_KEY`
- `DATABASE_URL` (in `.env`)
- `GCP_SERVICE_ACCOUNT_EMAIL` & `GCP_PRIVATE_KEY`
- `DRIVE_ROOT_FOLDER_ID` (The folder ID of `MAIN_DRIVE_FOLDER`)
- `TMDB_API_KEY` & `OMDB_API_KEY`

### 3. Install & Sync Database

```bash
cd frontend
npm install

# Push the schema structure to your Postgres database and generate the Prisma Client
npx prisma db push
npx prisma generate
```

### 4. Run the App

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.
Once signed in, click the **Refresh Library** button on the Home screen to pull in all your Drive content, fetch TMDB metadata, and start streaming!

## 📜 License
MIT License. Private use only.
