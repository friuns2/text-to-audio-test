<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Fhcxq4clgsLBg0ijang6nmEabjrgaDVu

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to GitHub Pages

1. Push your changes (including `.github/workflows/deploy.yml`) to the `main` branch.
2. In your GitHub repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions**.
3. Store `GEMINI_API_KEY` as a repository secret if you need it at build time (the workflow picks up standard Vite env values).
4. The `Deploy to GitHub Pages` workflow installs dependencies, builds the project, uploads `dist/`, and publishes it via the official `actions/deploy-pages`.

### Base path notes

- The workflow sets `VITE_BASE_PATH` automatically so assets resolve from either `https://<user>.github.io/<repo>/` or `https://<user>.github.io`.
- To preview the Pages build locally, run `VITE_BASE_PATH=/<your-repo>/ npm run build` (or `/` for `<user>.github.io` repos) followed by `npm run preview`.
