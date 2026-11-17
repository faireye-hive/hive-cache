# Hive Moderation Dashboard

Responsive moderation workspace for reviewing Hive posts, investigating flagged content, managing moderation lists, and syncing fresh data from HAFSQL or Hive RPC.

The Statistics view combines local moderation/cache indicators with read-only network analytics fetched directly from Hive's HAF Stats API at `https://api.hive.blog/haf-stats-api/`. The daily-active-users route uses its endpoint-specific `from_date`, `granularity`, and `operation_types` parameters. The view also shows content and vote trends, engagement, active accounts, and HP concentration.

## Development

Install dependencies, then run:

```sh
npm install
npm run dev
```

Vite serves the frontend at `http://localhost:5173` and proxies API and cache requests to the Express service on port `3000`.

## Production

```sh
npm run build
npm start
```

The Express server serves the generated `dist/` frontend and keeps the HAFSQL, Hive RPC, cache, and moderation API routes available. Set `PORT` to change the API/server port; set `VITE_PORT` only if the Vite port is customized in `vite.config.js`.
