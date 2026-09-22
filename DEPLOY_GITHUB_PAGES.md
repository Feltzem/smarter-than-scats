# Deploy to GitHub Pages

This repository is a Vite and React app. The Pages workflow builds the regular
web bundle with `npm run build:web`, then publishes `dist` using GitHub's Pages
deployment actions.

## Enable Pages

1. Push this repository to GitHub under the `feltzem` account.
2. Open the repository's **Settings** page.
3. Select **Pages** in the **Code and automation** section.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Save the setting.

## Trigger the first deployment

Push the deployment files to the `main` branch. The workflow also supports a
manual run from the repository's **Actions** tab: choose **Deploy to GitHub
Pages**, select **Run workflow**, and choose `main`.

The workflow builds with the repository base path, so JavaScript, CSS, images,
and public data resolve correctly from a project Pages URL. The app includes
its Site 36 data in the bundle and does not require an API or external server.

## Site URL

Once the workflow completes, the site will be available at:

`https://feltzem.github.io/smarter-than-scats/`

The general project-site format is:

`https://<github-user>.github.io/<repository-name>/`

## Local verification

```bash
npm ci
npm run build:web
npm run preview
```

For a local build that mirrors the hosted repository path, set
`VITE_BASE_PATH=/smarter-than-scats/` before running `npm run build:web`.