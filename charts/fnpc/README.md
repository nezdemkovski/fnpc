# FNPC Helm Chart

This chart deploys the FNPC Mastra service with:

- External Secrets backed by the `onepassword` ClusterSecretStore.
- Optional ClickHouse observability storage for Mastra traces and metrics.
- YNAB as the only source of truth for financial data.

## Postgres

Postgres is external to this chart. Provide the host, database, and a Kubernetes
Secret containing the username/password:

```yaml
postgres:
  host: fnpc-postgres-rw.fnpc.svc.cluster.local
  port: "5432"
  database: fnpc
  credentialsSecret:
    name: fnpc-postgres-owner
    usernameKey: username
    passwordKey: password
```

## Required 1Password Items

`fnpc`

- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `AUTH_SESSION_SECRET`
- `YNAB_ACCESS_TOKEN`
- `YNAB_PLAN_ID`

`fnpc-clickhouse`

- `username`
- `password`

## ClickHouse

When ClickHouse is enabled, the chart deploys a dedicated `fnpc-clickhouse`
StatefulSet and PVC in the `fnpc` namespace. Mastra receives `CLICKHOUSE_URL`,
`CLICKHOUSE_USERNAME`, and `CLICKHOUSE_PASSWORD`; Postgres remains the default
storage backend, while ClickHouse is used only for observability.
