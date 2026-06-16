# Deploy workflow

**Use git push only. Do not run `npx vercel --prod`.**

```bash
cd ~/fuel-log
git add . && git commit -m "what changed"
git push
```

Vercel auto-deploys from the GitHub `main` branch. Running the CLI in addition causes duplicate deployments — same commit deployed twice.

## If `git push` ever doesn't trigger a deploy

Likely cause: the Vercel ↔ GitHub integration got disconnected. Re-link in:
Vercel dashboard → fuel-log → Settings → Git → connect repo.

Only fall back to `npx vercel --prod` as a one-off if the integration is genuinely broken — then reconnect afterward.

## After a deploy

- Check status: `npx vercel ls` (or the Vercel dashboard)
- Server logs: `npx vercel logs https://fuel-log-snowy.vercel.app --since 5m`
- Frontend changes go live as soon as the build finishes (~30–50 s)
- Env var changes require a new deploy to take effect — push an empty commit if needed: `git commit --allow-empty -m "Bump deploy"`

## Where things live

- Source: `~/fuel-log` (this folder)
- Repo: https://github.com/Pliry137/Fuel-Log
- Deploy: https://fuel-log-snowy.vercel.app
- Data: Supabase project (URL in `SUPABASE_URL` env var)
