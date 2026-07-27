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
- `XAI_API_KEY`
- `BRAVE_SEARCH_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `MASTRA_JWT_SECRET`
- `MASTRA_JWT_TOKEN`

The API validates bearer tokens with `MASTRA_JWT_SECRET`. Studio uses the
preconfigured `MASTRA_JWT_TOKEN` as a token login and stores the authenticated
session in an HTTP-only cookie.

Model identifiers use Mastra's `provider/model` format. The default is
`xai/grok-4.5`; set `env.aiModel` to another registered model to override it.
Application API key names are configured through
`onepassword.appProperties` and injected from the `fnpc` item.

`Ynab`

- `token`

`fnpc-clickhouse`

- `username`
- `password`

## ClickHouse

When ClickHouse is enabled, the chart deploys a dedicated `fnpc-clickhouse`
StatefulSet and PVC in the `fnpc` namespace. Mastra receives `CLICKHOUSE_URL`,
`CLICKHOUSE_USERNAME`, and `CLICKHOUSE_PASSWORD`; Postgres remains the default
storage backend, while ClickHouse is used only for observability. The chart
disables ClickHouse's high-volume internal system logs and profilers, caps the
container at 500m CPU, and retains Mastra observability data for 14 days by
default.

YNAB uses the API-supported `last-used` plan selector unless `env.ynabPlanId`
is overridden.
