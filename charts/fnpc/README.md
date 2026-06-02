# FNPC Helm Chart

This chart deploys the FNPC Mastra service with:

- CloudNativePG Postgres for application and Mastra state.
- External Secrets backed by the `onepassword` ClusterSecretStore.
- Optional ClickHouse observability storage for Mastra traces and metrics.

## Required 1Password Items

`fnpc`

- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`

`fnpc-postgres`

- `DATABASE_URL`
- `username`
- `password`

`fnpc-clickhouse`

- `username`
- `password`

## ClickHouse

When ClickHouse is enabled, the chart deploys a dedicated `fnpc-clickhouse`
StatefulSet and PVC in the `fnpc` namespace. Mastra receives `CLICKHOUSE_URL`,
`CLICKHOUSE_USERNAME`, and `CLICKHOUSE_PASSWORD`; Postgres remains the default
storage backend, while ClickHouse is used only for observability.
