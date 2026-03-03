# Accounting Review

Multifamily property accounting review tool powered by Claude AI.

## Setup

```bash
npm install
npm run dev
```

## Environment Variables

Set this in Netlify's environment variable settings (never commit it):

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Deploy

Push to GitHub, connect repo to Netlify. Build settings are in `netlify.toml`:
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
