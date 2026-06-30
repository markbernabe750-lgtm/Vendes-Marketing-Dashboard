# Deployment Checklist

## Project Type

This dashboard is a static HTML/CSS/JavaScript web app. It is not Next.js, React, or Vue.

## Source and Output

- Source dashboard files: `outputs/dashboard/`
- Build output folder: `dist/`
- Build command: `npm run build`
- Local preview command: `npm run preview`

## Environment Variables

No environment variables are required right now. The dashboard reads the public Google Spreadsheet directly through the browser.

If the spreadsheet is made private later, add a backend/API layer first. Do not put private API keys directly in browser JavaScript.

## Routes and Assets

- `vercel.json` publishes `dist`.
- All routes rewrite to `/index.html`, so the web app still opens correctly if a user refreshes a deep link.
- Current assets are static files: `index.html`, `app.js`, and `styles.css`.

## GitHub Setup

Run these once after creating a GitHub repository:

```bash
git init
git branch -M main
git add .
git commit -m "Prepare dashboard for Vercel deployment"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

If this folder already has git initialized, skip `git init` and only add/commit/push.

## Vercel Settings

When importing the GitHub repository in Vercel:

- Framework Preset: Other
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`
- Root Directory: leave blank, unless this project is inside a subfolder in your GitHub repo

## Auto Deployment

After GitHub is connected to Vercel, every push to the `main` branch automatically redeploys the live public URL.
