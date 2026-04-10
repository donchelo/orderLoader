# OrderLoader 3.0 - Developer Guide

## Core Commands
- **Dev Server**: `npm run dev`
- **Build**: `npm run build`
- **Prod Mode**: `npm run start`
- **Deploy to GCP**: `./scripts/deploy.sh` (from local laptop)

## Automation & Tasks
- **Manual Pipeline Check**: `npx tsx scripts/cron-pipeline.ts`
- **Calculate IA Costs**: `npx tsx scripts/calculate-costs.ts`

## Deployment Context
- **Target VM**: `orderloader` (Ubuntu 22.04 LTS)
- **Project**: `gen-lang-client-0666118566`
- **Zone**: `us-central1-a`

## Coding Standards
- **Framework**: Next.js 15+ (App Router)
- **Database**: SQLite with `better-sqlite3`.
- **Logic**: Sequential pipeline in `lib/steps`.
- **Naming**: Spanish for business logic (pedidos, maestro, detalle), English for technical components.

## Troubleshooting
- **Cloud Logs**: `tail -f ~/orderLoader/pipeline-cron.log`
- **Server Logs**: `tail -f ~/orderLoader/server.log`
- **DB Backups**: Found in `.data/pedidos/backups/`.
