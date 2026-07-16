# YNAB Migration Plan

Status: implemented in code; live cutover is waiting for YNAB credentials

This document describes how FNPC should stop acting as a second budgeting
system and use YNAB as its financial system of record. It is intentionally a
migration record and operating runbook. The custom financial model has been
removed from application code. The destructive database migration is explicit
and must run only after the configured Postgres database has been backed up.

## Implementation status

Completed in the `0.2.0` code and chart:

- pinned official `ynab@4.5.0` SDK;
- one normalized full-plan snapshot with a 45-second disposable cache;
- deterministic overview, issue detection, spending analysis, and purchase
  evaluation;
- guarded `prepare-transaction` and `commit-transaction` tools;
- unapproved YNAB writes with stable `import_id` values and persistent audit;
- minimal `fnpc_profiles` and `fnpc_mutation_audit` schema;
- deletion of the custom ledger, repositories, workflows, and legacy evals;
- unit tests for milliunits, analysis, caching, ambiguity, confirmation, and
  write idempotency;
- Helm wiring for `YNAB_ACCESS_TOKEN` and `YNAB_PLAN_ID` through External
  Secrets.

Still required for live cutover:

1. Add `YNAB_ACCESS_TOKEN` and `YNAB_PLAN_ID` to `Homelab/fnpc` in 1Password.
2. Back up the FNPC Postgres database if the retained legacy volume is reused.
3. Publish image and chart `0.2.0`.
4. Re-enable the FNPC Argo CD application and Cloudflare route in GitOps.
5. Verify a read, a prepared write, an explicit confirmation, and exactly one
   unapproved YNAB transaction.

## Executive decision

YNAB owns financial state. FNPC reads and changes that state through the
official YNAB API and adds a small decision-support layer around it.

FNPC must not maintain a second ledger, duplicate balances, synchronize two
sets of categories, or infer financial truth from chat history. The language
model may route a request and explain a result, but all reads, calculations,
validations, and mutations must be deterministic.

The target relationship is:

```text
Banks and manual entries
          |
          v
         YNAB                 <- financial system of record and management UI
          |
          v
   Official YNAB SDK
          |
          v
  FNPC deterministic services <- snapshots, analysis, policies, write guards
          |
          v
     Mastra tools              <- typed capabilities exposed to the agent
          |
          v
 Financial agent               <- intent routing and answer presentation
          |
          v
 Telegram / Mastra Studio
```

## Goals

- Make YNAB the only source of truth for accounts, balances, categories,
  assignments, goals, transactions, payees, and scheduled transactions.
- Remove the custom financial ledger and most of the current mutation
  workflows.
- Keep calculations deterministic and testable outside the language model.
- Minimize API calls without building a general-purpose synchronization
  system.
- Preserve useful FNPC behavior: budget overview, purchase decisions,
  explanations, reviews, alerts, and convenient transaction capture.
- Make every write idempotent, explicit, auditable, and safe against stale
  state.
- Keep the architecture suitable for one owner first. Do not build multi-user
  OAuth infrastructure before it is needed.

## Non-goals

- Rebuilding the YNAB UI.
- Importing bank credentials or implementing bank synchronization.
- Supporting a second financial backend alongside YNAB long term.
- Maintaining a durable local mirror of the complete YNAB plan.
- Reproducing YNAB category, target, assignment, or transaction semantics in
  Postgres.
- Using the language model for arithmetic, reconciliation, balance updates, or
  business-rule execution.
- Solving multi-currency investment accounting. YNAB tracking accounts may be
  consumed, but FNPC will not become a brokerage or market-data system.

## Why the current architecture should be replaced

The current schema contains custom representations of:

- users and preferences;
- categories;
- accounts and balance history;
- income rules and income events;
- recurring, planned, and actual expenses;
- savings buckets and savings rules;
- financial goals;
- forecast runs and forecast items;
- a custom financial event log.

The Mastra layer then has separate tools and workflows for mutating most of
those entities. This produces three recurring problems:

1. Chat-derived state can disagree with the actual budget.
2. FNPC has to maintain financial semantics that YNAB already implements.
3. Every useful feature requires coordination across schema, repositories,
   workflows, tools, prompts, tests, and migration code.

Replacing repositories with an API adapter is not enough. The duplicated
domain model itself must be removed.

## Source-of-truth boundaries

### YNAB owns

- plan currency and formatting;
- accounts and their balances;
- category groups and categories;
- monthly assigned, activity, and available amounts;
- category targets and target progress;
- payees;
- transactions and split transactions;
- cleared, approved, and deleted transaction state;
- scheduled transactions;
- transfers and money movements exposed by the API;
- month summaries such as income, activity, and Ready to Assign.

### FNPC owns

- Mastra messages, memory, traces, and workflow state;
- Telegram and authenticated Studio identity mapping;
- preferred response language, display name, and timezone overrides;
- personal decision policy that is not represented by YNAB;
- short-lived API response caching;
- deterministic derived analyses;
- minimal audit records for mutations initiated by FNPC;
- proactive delivery schedules, once those features are added.

### The language model owns

- recognizing the user's intent;
- selecting the correct tool;
- extracting explicit parameters from the user's message;
- asking one narrow clarification when a deterministic service reports
  ambiguity;
- explaining a structured result in the user's language.

The language model does not own financial state or calculations.

## Current-to-YNAB ownership map

| Current FNPC concept | Target owner | Migration decision |
| --- | --- | --- |
| `financial_accounts` | YNAB accounts | Delete local entity |
| `financial_account_balances` | YNAB account balances | Delete local balance history |
| `financial_categories` | YNAB categories and groups | Delete local entity |
| `financial_actual_expenses` | YNAB transactions | Delete local entity |
| `financial_recurring_expenses` | YNAB scheduled transactions | Delete local entity |
| `financial_income_rules` | YNAB scheduled inflow transactions | Delete local entity |
| `financial_income_events` | YNAB transactions | Delete local entity |
| `financial_planned_expenses` | Scheduled transactions, category targets, or scenario input | Delete persistent local entity |
| `financial_savings_buckets` | YNAB categories | Delete local entity |
| `financial_savings_rules` | YNAB category targets and monthly assignments | Delete local entity |
| `financial_goals` | YNAB category targets | Delete local entity |
| `financial_forecast_runs` | Optional derived-analysis history | Do not keep in the first version |
| `financial_forecast_run_items` | Optional derived-analysis history | Do not keep in the first version |
| `financial_events` | Minimal FNPC mutation audit | Replace with a narrower audit model |
| `financial_users` | FNPC identity profile | Keep only identity and local policy fields, preferably under a new name |
| `financial_user_preferences` | FNPC profile | Merge into the identity profile or one JSON policy document |

## Important semantic changes

### Accounts are not savings buckets

In YNAB, accounts describe where money is located. Categories describe what
the money is for. FNPC must not treat a savings account balance as protected
savings automatically.

Protected money should be derived from selected YNAB categories or category
groups. An account named `Savings` can still contain money assigned to several
different jobs.

### Ready to Assign is not free spending money

Purchase evaluation must prefer the category selected for the purchase:

1. Read the category's current available amount.
2. Compare the proposed purchase with that amount.
3. Show the shortfall or remaining amount.
4. Only discuss Ready to Assign or reallocation when the category is
   insufficient.
5. Never silently consume protected categories or infer that another category
   is available for reallocation.

The personal policy may define categories that are protected, flexible, or
eligible for reallocation. That policy remains local because it represents the
owner's judgment, not YNAB financial state.

### Scheduled transactions and category targets are different

- A scheduled transaction represents expected money movement on a date.
- A category target represents how much should be assigned or available.

FNPC must not count both as separate expenses when they represent the same
obligation. Forecast code needs an explicit deduplication rule and fixtures for
this case.

### Money units change

The current FNPC domain stores currency minor units using two decimal places.
YNAB uses milliunits.

The new integration must use a branded `Milliunits` type inside the YNAB
boundary. Conversion to display amounts must use the plan currency format and
occur only at presentation boundaries. Existing `amountMinor` helpers must not
be reused for YNAB values.

Never mix these units in the same function signature.

## Official SDK

Use the official JavaScript/TypeScript package and pin its exact version:

```bash
bun add ynab@4.5.0
```

Repository: <https://github.com/ynab/ynab-sdk-js>

API documentation: <https://api.ynab.com/>

Endpoint documentation: <https://api.ynab.com/v1>

The SDK is generated from YNAB's OpenAPI specification and provides typed
clients for plans, accounts, categories, months, payees, transactions,
scheduled transactions, and money movements.

Do not call SDK methods directly from Mastra tools. Put a thin gateway between
the SDK and the application so that the rest of FNPC is independent of
generated SDK types and error shapes.

## Implemented code structure

```text
src/
  ynab/
    gateway.ts              # Lazy SDK client and short TTL cache
    snapshot.ts             # Stable normalized application model
    analysis.ts             # Overview, issues, spending, purchase policy
    transaction-service.ts  # Persistent prepare/confirm/write guard
    *.test.ts               # Sanitized deterministic fixtures

  finance/
    dates.ts                # User-timezone date boundaries
    money.ts                # Branded milliunits and plan formatting

  profile/
    service.ts              # Identity, language, timezone, local policy

  mastra/
    tools/
      ynab-read-tools.ts
      ynab-transaction-tools.ts
      profile-tool.ts
    agents/
      financial-agent.ts
```

There are no financial Mastra workflows in the current version. A workflow
should return only for a genuinely resumable proactive review process.

## YNAB gateway contract

Start with the smallest interface required by product behavior. Do not wrap
every SDK endpoint preemptively.

Initial read contract:

```ts
interface YnabGateway {
  getPlanSnapshot(): Promise<YnabPlanSnapshot>;
  getTransaction(transactionId: string): Promise<YnabTransaction>;
}
```

Initial write contract:

```ts
interface YnabGateway {
  createTransaction(input: CreateYnabTransaction): Promise<YnabTransaction>;
  updateTransaction(
    transactionId: string,
    input: UpdateYnabTransaction,
  ): Promise<YnabTransaction>;
}
```

Add scheduled-transaction and category-assignment methods only when the
corresponding product action is approved for implementation.

The gateway is responsible for:

- applying the configured access token and plan ID;
- calling the official SDK;
- mapping SDK errors into stable application errors;
- recognizing authentication, authorization, rate-limit, conflict, and missing
  resource failures;
- keeping milliunits intact;
- never logging access tokens or complete response bodies;
- attaching safe request metadata to observability spans.

The gateway is not responsible for business analysis or language-model tool
behavior.

## Configuration and secrets

For the current single-owner deployment use a YNAB Personal Access Token.

Required configuration:

```text
YNAB_ACCESS_TOKEN=<secret>
YNAB_PLAN_ID=<explicit plan UUID>
```

Use an explicit plan UUID after initial discovery. Do not depend on `default`
or `last-used` in production because changing a YNAB setting could silently
switch FNPC to another plan.

Homelab ownership:

- store `YNAB_ACCESS_TOKEN` in the existing `Homelab/fnpc` 1Password item;
- the chart maps it through External Secrets into the FNPC pod;
- keep `YNAB_PLAN_ID` beside it for simple operational ownership, even though
  the ID itself is not a credential;
- never expose either value to the language model, Telegram output, logs,
  traces, or eval fixtures.

OAuth is explicitly deferred. If FNPC later supports other users, introduce a
separate encrypted connection model and YNAB Authorization Code + PKCE flow.
Do not make the personal deployment pay the complexity cost now.

## Snapshot and cache strategy

Do not build a synchronization daemon in the first version.

Initial strategy:

1. Fetch a plan snapshot on demand.
2. Share the snapshot across all tools used during one agent turn.
3. Keep a short in-memory TTL cache, initially 30 to 60 seconds.
4. Allow explicit refresh for a mutation and for user requests such as
   "refresh" or "check now".
5. After a successful mutation, invalidate the cached snapshot.

This provides fresh data with very little code. The YNAB API limit is 200
requests per access token per hour, so one plan read per agent turn is a useful
initial budget.

Do not add Redis, a Postgres snapshot table, or incremental merge logic until
measurement shows a real need.

Possible later optimization:

- retain `server_knowledge` and request deltas;
- merge deltas into a cached plan snapshot;
- use Redis only if FNPC runs multiple replicas;
- periodically pre-warm snapshots for proactive reports.

The later optimization must preserve the rule that the cache is disposable and
YNAB remains authoritative.

## Normalized snapshot

The SDK response should be normalized once into a stable application type.
The language model must never consume the raw full YNAB response.

The snapshot should contain only fields required by deterministic services:

```ts
type YnabPlanSnapshot = {
  fetchedAt: Date;
  planId: string;
  planName: string;
  currency: CurrencyFormat;
  currentMonth: MonthSummary;
  accounts: AccountSummary[];
  categoryGroups: CategoryGroupSummary[];
  transactions: TransactionSummary[];
  scheduledTransactions: ScheduledTransactionSummary[];
};
```

Normalization should:

- filter deleted entities unless an audit use case explicitly needs them;
- preserve YNAB IDs as opaque strings;
- preserve milliunits;
- distinguish transfer transactions from spending;
- retain approved, cleared, and category state;
- retain enough target information to explain underfunding;
- avoid storing the normalized result in Postgres.

## Minimal local data model

The first target should have only two FNPC-owned financial tables, or their
equivalent fields in an existing profile table.

### FNPC profile

Implemented fields:

```text
id
mastra_resource_id
telegram_user_id
display_name
preferred_name
response_language
timezone
financial_policy
created_at
updated_at
```

`financial_policy` currently contains:

```json
{
  "minimumComfortableReadyToAssignMilliunits": 500000
}
```

All amounts in policy must use documented units. Prefer YNAB milliunits to
avoid conversion at analysis boundaries.

### FNPC mutation audit

Implemented fields:

```text
id
mastra_resource_id
action
source_message_id
ynab_entity_type
ynab_entity_id
idempotency_key
status
request
safe_summary
confirmation_token_hash
expires_at
error_code
created_at
updated_at
```

This is not an event-sourced financial ledger. It exists only to answer:

- what did FNPC attempt;
- which YNAB object was affected;
- whether the operation succeeded;
- which message or workflow initiated it;
- whether a repeated request has already been committed.

Do not store access tokens or raw full API payloads in the audit table.

## Minimal Mastra surface

The current agent has too many narrow workflow-backed mutation tools. The
target surface should start with four read tools and two write tools.

### Read tools

#### `get-budget-overview`

Returns deterministic current state:

- Ready to Assign;
- account totals, separated into on-budget and tracking accounts;
- category availability;
- current month assigned and activity;
- upcoming scheduled inflows and outflows;
- concise warnings.

#### `list-budget-issues`

Returns ranked items requiring attention:

- overspent categories;
- underfunded targets;
- uncategorized transactions;
- unapproved transactions;
- stale scheduled transactions;
- unusual spending only after a deterministic rule is defined.

#### `get-spending-analysis`

Returns category and payee analysis for an explicit period. It performs all
aggregation in code and returns already calculated numbers.

#### `evaluate-purchase`

Accepts amount, intended category, and optional date. It returns a structured
decision with no model arithmetic:

- current category availability;
- remaining or missing amount;
- upcoming scheduled obligations;
- selected personal policy warnings;
- baseline and scenario values;
- explicit assumptions;
- evidence IDs used in the calculation.

### Write tools

#### `prepare-transaction`

Resolves account, payee, category, date, and amount against a fresh snapshot.
It never writes. It returns a normalized preview and either:

- `ready` with a confirmation token;
- `ambiguous` with a small candidate list;
- `invalid` with a deterministic reason.

#### `commit-transaction`

Accepts the confirmation token, revalidates the relevant YNAB state, creates
the transaction, invalidates the cache, and returns the resulting YNAB entity.

Transactions created from chat should initially be unapproved so the normal
YNAB review flow remains available.

Use a stable YNAB `import_id` derived from the source message or audit record
when supported by the current SDK contract. This makes retries idempotent.

### Later write tools

Only add these after transaction capture is stable:

- prepare/commit category assignment;
- prepare/commit scheduled transaction;
- approve or recategorize an existing transaction;
- move money between categories if the API contract supports the intended
  semantics safely.

Do not expose a generic `mutate-ynab` tool.

## Agent and workflow policy

Use an agent for open-ended user requests and tool selection. Use a workflow
only for a structured, resumable process.

### Should be plain deterministic services behind tools

- budget overview;
- category status;
- transaction search;
- spending aggregation;
- purchase evaluation;
- mutation preparation and validation.

### May become Mastra workflows

- a scheduled weekly or monthly review with delivery;
- a persistent mutation approval flow if prepare/commit tokens are not enough;
- a multi-stage cleanup of uncategorized transactions;
- a proactive alert pipeline with deduplication.

Do not model a single SDK call as a multi-step workflow merely for consistency.

## Product behavior with minimal AI

The highest-value first version is not a general financial chatbot. It is a
small set of reliable questions and actions.

### 1. Budget overview

Example requests:

- "What is the money situation?"
- "What is left this month?"
- "What still needs attention?"

The result comes from one normalized snapshot and deterministic overview code.
The model only chooses how much detail to present.

### 2. Purchase sanity check

Example requests:

- "Can I spend 300 EUR on a monitor?"
- "Can I buy it this month?"

The service evaluates the relevant category, upcoming scheduled transactions,
and local policy. It must expose assumptions rather than fabricating certainty.

### 3. Budget inbox

Example requests:

- "What do I need to fix in YNAB?"
- "Show uncategorized transactions."

This can provide substantial value with no generative finance logic.

### 4. Weekly and monthly review

Summaries should be generated from deterministic comparison objects:

- category spending versus assignment;
- spending versus prior periods;
- target progress;
- notable payee changes;
- recurring obligations;
- unresolved transactions.

The model writes the narrative after calculations are complete.

### 5. Telegram transaction capture

Example:

```text
Spent 24.50 EUR at Lidl from Revolut, groceries.
```

FNPC resolves known YNAB entities, shows a preview when needed, and creates one
unapproved transaction after confirmation. It does not update a separate local
balance.

## Mutation safety rules

- Start the migration in read-only mode.
- Never mutate YNAB from a generic profile-ingestion tool.
- Every write has a prepare and commit boundary.
- Require explicit confirmation when amount, account, category, transaction,
  or action is ambiguous.
- Re-fetch relevant state immediately before committing.
- Use idempotency for retried transaction creation.
- Invalidate cached data after every successful write.
- Return the YNAB entity ID and a concise committed summary.
- Do not claim success before the SDK response confirms it.
- Do not silently reconcile or adjust account balances.
- Do not delete YNAB entities during the first write phase.
- Prefer creating transactions as unapproved initially.
- Never pass the access token or raw SDK errors into model context.

## Forecast redesign

Do not port the current forecast engine unchanged. First define which decision
the forecast must support.

The initial purchase evaluation should use:

- current category available amount;
- current Ready to Assign;
- upcoming scheduled transactions;
- current month target underfunding;
- explicit personal reserve policy;
- optional historical average spending for the category.

Avoid a six-month pseudo-bank forecast until we have evidence that it improves
decisions. YNAB is category-oriented, while the existing forecast is a custom
cashflow model. Mixing those models without a precise contract will recreate
the complexity we are removing.

If a future cashflow forecast is still wanted, specify it as a pure function:

```ts
evaluateScenario(snapshot, policy, scenario): ScenarioResult
```

The function must not read a database, call an API, invoke a model, or persist
state. It should receive all assumptions explicitly and return an explainable
breakdown.

## Migration phases

### Phase 0: freeze and baseline

Tasks:

- stop adding features to the custom ledger;
- capture representative Telegram prompts and expected answers;
- export or back up the current Postgres database;
- record the current YNAB plan structure and category conventions;
- decide which YNAB category groups are protected or flexible;
- establish a separate YNAB test plan if write integration tests are required.

Exit criteria:

- backup is restorable;
- expected behavior fixtures exist;
- no migration work depends on undocumented current chat state.

### Phase 1: connect the official SDK

Tasks:

- add and pin `ynab@4.5.0`;
- add `YNAB_ACCESS_TOKEN` and explicit `YNAB_PLAN_ID` configuration;
- wire the fields through 1Password, External Secrets, and the Helm chart;
- implement the client and gateway;
- add authentication, missing-plan, rate-limit, and safe-error tests;
- verify a read-only plan request locally and in the homelab.

Exit criteria:

- FNPC can identify the configured plan and currency;
- secrets do not appear in logs or traces;
- no agent tool has direct access to the token or raw SDK client.

### Phase 2: normalized read model

Tasks:

- define branded milliunits;
- normalize the plan response into `YnabPlanSnapshot`;
- add sanitized fixtures based on the real plan shape;
- implement request-local and short-TTL caching;
- implement overview and issue-detection services;
- expose `get-budget-overview` and `list-budget-issues` tools.

Exit criteria:

- overview totals match YNAB for the same month;
- overspent, underfunded, unapproved, and uncategorized test cases match
  expected fixtures;
- a complete user turn performs no more than one full snapshot fetch in the
  normal path;
- no local financial table is used by the new read tools.

### Phase 3: replace reports and explanations

Tasks:

- implement spending analysis by category and payee;
- rebuild weekly/monthly reports from YNAB snapshots;
- replace balance and provenance explanations with YNAB evidence;
- simplify agent instructions and remove routes to old read tools;
- run old and new read paths against representative prompts for comparison.

Exit criteria:

- all user-facing read scenarios use YNAB;
- the agent never answers a balance or category question from custom tables;
- report calculations have deterministic tests.

### Phase 4: replace purchase evaluation

Tasks:

- agree on the exact purchase-decision policy;
- implement category-first purchase evaluation;
- represent all assumptions in the structured result;
- add fixtures for sufficient category funds, insufficient funds, protected
  money, scheduled obligations, and missing category;
- replace the old forecast-backed purchase tool.

Exit criteria:

- the same snapshot and scenario always produce the same decision;
- every amount in an answer maps to a structured calculation field;
- no old forecast table or repository is used.

### Phase 5: add controlled transaction writes

Tasks:

- implement prepare/commit transaction tools;
- use fresh state and candidate resolution;
- create transactions as unapproved initially;
- add idempotency using source message or audit IDs;
- write minimal mutation audit records;
- test retry, ambiguity, SDK timeout, conflict, and stale confirmation cases;
- enable writes only after read-only behavior is stable.

Exit criteria:

- a Telegram transaction appears once in YNAB;
- retrying the same source message cannot create duplicates;
- failed writes do not change local financial state;
- the cache is invalidated after success;
- the agent accurately reports failures.

### Phase 6: delete the custom financial backend

Tasks:

- remove old tools from the agent;
- remove old workflows from Mastra registration;
- remove custom finance repositories and writers;
- remove obsolete forecast and ledger code;
- replace the schema with FNPC profile and mutation audit only;
- create an explicit destructive migration for legacy tables;
- remove obsolete eval datasets and rewrite useful scenarios against YNAB
  fixtures;
- remove temporary backend feature flags.

Do not maintain long-term `custom | ynab` branching. A temporary read-path flag
is acceptable only while comparing results before cutover.

Exit criteria:

- no production code imports legacy financial tables;
- no custom account, balance, transaction, category, or savings entity remains;
- database restore and YNAB reconnection procedures are documented;
- typecheck, unit tests, build, Helm lint, rollout, and live smoke tests pass.

### Phase 7: high-value automation

Only after the simplified core is stable:

- scheduled weekly review;
- month-end review;
- uncategorized or unapproved transaction reminders;
- underfunded or overspent category alerts;
- unusual spending alerts with deterministic thresholds;
- target progress notifications.

Each proactive feature needs deduplication so FNPC does not repeat the same
alert on every poll.

## Test strategy

### Unit tests

- milliunit conversion and formatting;
- snapshot normalization;
- deleted and transfer entity handling;
- category availability calculations;
- scheduled transaction filtering;
- issue detection;
- purchase scenarios;
- transaction candidate matching;
- idempotency key generation;
- safe SDK error mapping.

### Tool contract tests

- schemas accept only explicit required parameters;
- tools return structured data rather than prose-only output;
- ambiguous matches return candidates instead of guessing;
- read tools never invoke writes;
- commit tools reject expired or mismatched confirmation tokens.

### Agent evals

- routes overview questions to overview;
- routes purchase questions to purchase evaluation;
- routes actual spending to prepare transaction;
- asks for account/category clarification only when required;
- never performs arithmetic from conversational memory;
- never claims a write succeeded when the tool failed;
- does not treat account location as category purpose.

### Integration tests

Use a separate YNAB plan for write tests. Do not run destructive tests against
the personal plan.

- read configured plan;
- create one uniquely identified unapproved transaction;
- retry without duplication;
- update or delete only the test-created transaction;
- verify rate-limit and authentication error handling through mocks rather than
  intentionally exhausting or revoking production credentials.

## Observability

Record safe operational metrics:

- YNAB request count by operation;
- latency by operation;
- cache hit and miss count;
- authentication and rate-limit failures;
- normalization failures;
- tool result type: success, ambiguous, invalid, or external failure;
- mutation prepare, commit, retry, and deduplication counts.

Do not record:

- access tokens;
- complete plan exports;
- complete transaction memos;
- raw model prompts containing unnecessary financial data;
- unfiltered SDK errors or HTTP headers.

## Rollback strategy

Before Phase 6, rollback means deploying the last custom-backend image and
restoring its compatible database backup.

After Phase 6, YNAB remains the authoritative financial state, so the service
can be rebuilt from code and reconnected using the token and plan ID. FNPC
profile and audit data may be restored from Postgres, but no financial ledger
reconstruction should be required.

Do not use dual writes as a rollback mechanism. They create the inconsistency
this migration is intended to eliminate.

## Product decisions after cutover

These questions should be answered against actual usage before expanding the
small initial product layer:

1. Which category or category group should a purchase use when the user does
   not name one?
2. Which categories are protected and must never be suggested for
   reallocation?
3. Does `minimumComfortableAvailable` apply to Ready to Assign, selected
   categories, total on-budget cash, or a dedicated reserve category?
4. Should transaction capture always require confirmation, or only when entity
   matching is ambiguous?
5. Which writes are valuable beyond transaction capture?
6. Is a future cashflow forecast still needed after category-first purchase
   evaluation is available?
7. Which proactive review cadence is useful without becoming noisy?
8. How much transaction history should spending analysis load by default?
9. Should tracking accounts be included in net-worth reports but excluded from
   purchase decisions?
10. Which parts of the current agent behavior are genuinely useful and should
    become deterministic product capabilities?

## Live cutover runbook

1. Create a Postgres backup before applying migration
   `20260716150726_modern_thor_girl` to a database containing legacy FNPC data.
2. Put the YNAB Personal Access Token and explicit plan UUID in 1Password.
3. Confirm External Secrets reports `SecretSynced` before starting the pod.
4. Verify `get-budget-overview` against the same current month in YNAB.
5. Verify issue counts and one 30-day spending analysis manually.
6. Prepare a uniquely named low-value test expense and inspect the preview.
7. Confirm it once and verify exactly one unapproved YNAB transaction exists.
8. Repeat the commit call and verify no second transaction is created.
9. Keep the legacy Postgres backup until the first weekly review is correct.

Do not add dual writes or restore the custom ledger during rollback. If the new
service is disabled, YNAB remains complete and authoritative.

## Definition of done

The migration is complete when:

- YNAB is the only financial system of record;
- FNPC has no custom ledger or duplicate financial entities;
- all calculations are deterministic and independently tested;
- the agent only routes intent and presents structured results;
- transaction writes are idempotent and guarded;
- secrets remain outside model context and logs;
- the homelab deployment can be rebuilt without restoring financial state from
  FNPC Postgres;
- the useful user experience is better despite substantially less code.
