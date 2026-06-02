# FNPC Helm Chart

This chart deploys the FNPC Mastra service with:

- CloudNativePG Postgres for application and Mastra state.
- External Secrets backed by the `onepassword` ClusterSecretStore.
- Optional ClickHouse observability storage for Mastra traces and metrics.

## Required 1Password Items

`fnpc`

- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `CLICKHOUSE_PASSWORD`

`fnpc-postgres`

- `DATABASE_URL`
- `username`
- `password`

`plausible`

- `CLICKHOUSE_PASSWORD`

## ClickHouse

The chart expects the existing homelab ClickHouse service to be reachable at:

`plausible-clickhouse.plausible.svc.cluster.local`

When ClickHouse is enabled, a sync job creates the `fnpc` database and `fnpc` user, then grants that user rights on `fnpc.*`. Mastra receives `CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME`, and `CLICKHOUSE_PASSWORD`; Postgres remains the default storage backend, while ClickHouse is used only for observability.
