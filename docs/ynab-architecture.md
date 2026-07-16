# YNAB Architecture

FNPC treats YNAB as a provider with a set of small capabilities. The language
model coordinates those capabilities; it does not receive a full plan export and
it does not reconstruct current financial state from memory.

## Layers

```text
User request
  -> Mastra agent orchestration
  -> one or more narrow YNAB tools
  -> YnabGateway method
  -> one YNAB SDK endpoint
```

The code is split into three responsibilities:

- `src/ynab/gateway.ts` maps application methods one-to-one to YNAB SDK calls and
  sanitizes provider errors.
- `src/ynab/presenters.ts` converts provider field names into compact,
  model-friendly values without fetching more data or applying business rules.
- `src/mastra/tools/ynab/` exposes one Mastra tool per endpoint capability.

## Endpoint Tool Contract

Every provider tool must follow these rules:

1. Call exactly one YNAB SDK endpoint.
2. Have a short description that says which resource it reads.
3. Use a strict Zod input matching the provider endpoint.
4. Return the endpoint name, fetch time, server knowledge when available, and a
   compact projection of the provider response.
5. Never resolve names by silently calling another endpoint.
6. Never read conversation memory as a financial data source.
7. Never hide multi-resource analysis inside a provider tool.

Local projection is allowed. For example, transaction tools can cap the number
of returned rows while reporting `totalCount`, `returnedCount`, and `truncated`.
If a result is truncated, the agent must narrow the date range or choose a more
specific endpoint.

## Read Capabilities

The current read layer exposes:

- plan settings;
- account list and account detail;
- category list, category detail, and month-category detail;
- month list and month detail;
- payee list and payee detail;
- scheduled transaction list and detail;
- plan, account, category, month, and payee transaction lists;
- transaction detail.

When the user gives a name instead of an ID, the agent first calls the matching
list tool, selects the exact entity, and then calls the scoped detail or
transaction tool. Ambiguous names stay ambiguous until the user or returned data
resolves them.

## Analysis

Analysis is orchestration, not a second database.

Examples:

- Current budget health: `getMonth` plus targeted account, transaction review,
  and scheduled transaction calls.
- Category spending: resolve the category with `listCategories`, then call
  `listCategoryTransactions` for the requested dates.
- Affordability: read the intended category for the relevant month and compare
  its available amount with the purchase. Account balance alone is insufficient.
- Historical comparison: call the relevant month or transaction endpoint for
  each period and calculate from those returned values.

This makes every number traceable to a provider response from the current turn.

## Memory Boundary

FNPC uses resource-scoped Mastra working memory and observational memory for:

- communication preferences;
- decision criteria and risk tolerance;
- long-term goals and constraints;
- non-financial recurring context;
- unresolved follow-ups.

Memory must not persist YNAB balances, category amounts, transactions, targets,
schedules, or provider entity IDs as authoritative facts. These values can
change independently and must be refreshed with endpoint tools.

The local profile remains the explicit source for preferred name, language, and
timezone. It is injected into runtime context without making a YNAB request.

## Writes

Writes are deliberately not raw endpoint tools. They are guarded workflows:

1. `prepareTransaction` reads the relevant account, month, and plan settings.
2. It resolves exact entities, validates the request, writes an audit record,
   and returns a short-lived confirmation token plus a safe summary.
3. The agent shows the summary and waits for explicit user confirmation.
4. `commitPreparedTransaction` revalidates the exact account and category.
5. It creates an unapproved YNAB transaction with an idempotent import ID.

The confirmation and audit boundary is domain logic. It may compose endpoint
calls, but it is kept separate from the one-endpoint provider tool layer.

## Adding A Capability

For a new YNAB endpoint:

1. Add one gateway method with the same resource and parameters as the SDK.
2. Add or reuse a presenter that performs only field normalization.
3. Add one tool in the matching file under `src/mastra/tools/ynab/`.
4. Export the tool from `src/mastra/tools/ynab/index.ts`.
5. Register it on the financial agent and add one concise selection rule.
6. Test argument forwarding, error sanitization, and the returned projection.

Do not add a full-plan cache, snapshot table, hidden delta merge, or broad
"finance data" tool. If several endpoint calls form a stable business process,
model that process as an explicit workflow above the provider layer.
