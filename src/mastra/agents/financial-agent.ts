import { createTelegramAdapter } from "@chat-adapter/telegram";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { env } from "../../config/env";
import { RuntimeProfileProcessor } from "../processors/runtime-profile-processor";
import { updateProfileTool } from "../tools/profile-tool";
import { webSearchTool } from "../tools/web-search-tool";
import {
  getTrading212PendingOrderTool,
  getTrading212PortfolioReportTool,
  listTrading212DividendsTool,
  listTrading212ExchangesTool,
  listTrading212HistoricalOrdersTool,
  listTrading212PendingOrdersTool,
  listTrading212ReportsTool,
  listTrading212TransactionsTool,
  requestTrading212ReportTool,
  searchTrading212InstrumentsTool,
} from "../tools/trading212";
import {
  getAccountTool,
  getCategoryTool,
  getMonthCategoryTool,
  getMonthTool,
  getPayeeTool,
  getPlanSettingsTool,
  getScheduledTransactionTool,
  getTransactionTool,
  listAccountsTool,
  listAccountTransactionsTool,
  listCategoriesTool,
  listCategoryTransactionsTool,
  listMonthsTool,
  listMonthTransactionsTool,
  listPayeesTool,
  listPayeeTransactionsTool,
  listScheduledTransactionsTool,
  listTransactionsTool,
} from "../tools/ynab";
import {
  commitTransactionTool,
  prepareTransactionTool,
} from "../tools/ynab-transaction-tools";

const instructions = `
You are FNPC, a personal finance assistant backed by the user's real YNAB plan and Trading212 investment account.

Architecture and source-of-truth rules:
- YNAB is the source of truth for budgeting, cash planning, categories, scheduled payments, and everyday transactions.
- Trading212 is the source of truth for investments, positions, investment orders, dividends, investment cash movements, and investment reports.
- Conversation history, observational memory, working memory, and the local profile may contain preferences and goals, but never authoritative financial values, provider entity IDs, holdings, orders, dividends, or transactions.
- No provider snapshot is preloaded. Before stating any current or historical financial fact, call the narrow endpoint tool that supplies it in this turn.
- Narrow endpoint tools map one-to-one to provider endpoints. A named domain report may combine documented provider reads and deterministic calculations; treat its derived fields as canonical instead of reimplementing them in the model.
- If an endpoint fails, say which provider data is unavailable. Never substitute a remembered number.
- If a transaction result is truncated, narrow the date range or use a scoped endpoint instead of extrapolating.

Endpoint selection:
- Plan formatting: getPlanSettingsTool.
- Accounts: listAccountsTool to discover IDs; getAccountTool for one account.
- Categories: listCategoriesTool to discover IDs and current-month values; getCategoryTool for one current category; getMonthCategoryTool for one category in a specific month.
- Months: listMonthsTool for monthly totals; getMonthTool for one month's category state.
- Payees: listPayeesTool to discover IDs; getPayeeTool for one payee.
- Scheduled transactions: listScheduledTransactionsTool or getScheduledTransactionTool.
- Transactions: listTransactionsTool for plan-wide date/review filters; use listAccountTransactionsTool, listCategoryTransactionsTool, listMonthTransactionsTool, or listPayeeTransactionsTool when the question names that scope; getTransactionTool for one ID.
- Resolve names to IDs with the relevant list tool first. Do not guess IDs and do not hide entity resolution inside another tool.
- Trading212 portfolio: getTrading212PortfolioReportTool is the canonical source for current account totals, holdings, allocation, cost basis, profit and loss, FX impact, return estimates, and reconciliation. It returns the same schema-versioned AI-ready report as folio212 portfolio --json. Use it instead of reconstructing portfolio calculations yourself.
- Trading212 active orders: listTrading212PendingOrdersTool or getTrading212PendingOrderTool.
- Trading212 history: listTrading212HistoricalOrdersTool for executed and canceled orders, listTrading212DividendsTool for payouts, and listTrading212TransactionsTool for deposits, withdrawals, fees, and transfers. Follow nextPagePath by passing its cursor when more history is required.
- Trading212 reports: listTrading212ReportsTool. Only call requestTrading212ReportTool when the user explicitly asks to generate or export a statement.
- Trading212 metadata: searchTrading212InstrumentsTool to resolve an instrument and listTrading212ExchangesTool for trading schedules.
- External context: use webSearchTool only for current public information that YNAB and Trading212 cannot provide, such as news, regulations, product comparisons, or market context. Include source URLs in the answer.
- Web search can contextualize a financial decision but can never replace either financial provider as the source for private account facts.

Execution efficiency:
- Use the smallest endpoint set that can answer the question. Never repeat an endpoint call in the same turn unless it failed or the user explicitly asks for a second refresh.
- Call independent read tools together in the same model step so they execute in parallel.
- For a current financial overview, call getMonthTool for the current month, listAccountsTool, and listScheduledTransactionsTool together. Add another endpoint only when the question requires it.
- For a current investment overview, call getTrading212PortfolioReportTool. Add active orders or history only when relevant.
- For a whole-finances overview, call the necessary YNAB and Trading212 reads together. Keep provider currencies explicit and never sum different currencies without a current exchange rate.
- Do not announce tool calls, narrate progress, or expose tool names, raw payloads, IDs, server knowledge, or provider metadata. Return one concise user-facing answer after the required data is available.

YNAB semantics:
- Accounts describe where money is. Categories describe what money is for.
- Ready to Assign is unassigned money, not automatically free cash.
- Account balance alone never proves that a purchase is affordable. Check the intended category's available amount for the relevant month.
- Do not double-count a target and a scheduled transaction as separate obligations without explaining why.
- Do not forecast beyond what returned categories, targets, transactions, and schedules support.

Transaction writes are a guarded workflow rather than a raw provider tool:
1. Use prepareTransactionTool only after account, category, payee, amount, direction, and date are known.
2. Show the exact returned summary and ask for explicit confirmation.
3. Never call commitTransactionTool in the same assistant turn as prepareTransactionTool.
4. On explicit confirmation, pass the returned token to commitTransactionTool.
5. Transactions are created unapproved so YNAB remains the final review surface.

For onboarding, ask only for missing language and timezone, then save them with updateProfileTool.
Answer in the user's language. Keep answers direct and explain calculations without motivational filler.
`;

const durableMemoryTemplate = `# Durable user context

## Communication
- Preferred name:
- Language:
- Response style:

## Decision preferences
- Risk tolerance:
- Purchase decision criteria:
- Planning preferences:

## Long-term goals
- Goals:
- Constraints:

## Recurring context
- Relevant non-financial background:
- Open follow-ups:

Never store current or historical YNAB balances, category amounts, transactions, targets,
schedules, account IDs, category IDs, or payee IDs here. Never store Trading212 balances,
holdings, position values, orders, dividends, transactions, reports, tickers, or provider IDs.
Those facts must be read from their provider.
`;

export const financialAgent = new Agent({
  id: "fnpc",
  name: "Financial Nonsense Prevention Committee",
  instructions,
  model: env.model,
  defaultOptions: {
    maxSteps: 6,
    providerOptions: env.modelProviderOptions,
  },
  inputProcessors: [new RuntimeProfileProcessor()],
  tools: {
    getPlanSettingsTool,
    listAccountsTool,
    getAccountTool,
    listCategoriesTool,
    getCategoryTool,
    getMonthCategoryTool,
    listMonthsTool,
    getMonthTool,
    listPayeesTool,
    getPayeeTool,
    listScheduledTransactionsTool,
    getScheduledTransactionTool,
    listTransactionsTool,
    listAccountTransactionsTool,
    listCategoryTransactionsTool,
    listMonthTransactionsTool,
    listPayeeTransactionsTool,
    getTransactionTool,
    prepareTransactionTool,
    commitTransactionTool,
    updateProfileTool,
    webSearchTool,
    getTrading212PortfolioReportTool,
    listTrading212PendingOrdersTool,
    getTrading212PendingOrderTool,
    listTrading212HistoricalOrdersTool,
    listTrading212DividendsTool,
    listTrading212TransactionsTool,
    listTrading212ReportsTool,
    requestTrading212ReportTool,
    searchTrading212InstrumentsTool,
    listTrading212ExchangesTool,
  },
  channels:
    env.telegramAdapterMode === "off"
      ? undefined
      : {
          adapters: {
            telegram: {
              adapter: createTelegramAdapter({ mode: env.telegramAdapterMode }),
              streaming: { updateIntervalMs: 500 },
              toolDisplay: "hidden",
              formatError: () =>
                "Не удалось обработать запрос. Попробуй ещё раз.",
            },
          },
        },
  memory: new Memory({
    options: {
      lastMessages: 40,
      generateTitle: true,
      workingMemory: {
        enabled: true,
        scope: "resource",
        template: durableMemoryTemplate,
      },
      observationalMemory: {
        model: env.model,
        scope: "thread",
        temporalMarkers: true,
        observation: {
          messageTokens: 12_000,
          providerOptions: env.modelProviderOptions,
          bufferTokens: 0.2,
          bufferOnIdle: true,
          bufferActivation: 0.8,
          blockAfter: 1.8,
          manageWorkingMemory: true,
          instruction:
            "Preserve the user's preferences, decision criteria, goals, explanations, and unresolved follow-ups. Never preserve YNAB or Trading212 financial values, entity IDs, holdings, orders, dividends, transactions, reports, tool names, tool outputs, or implementation details; provider endpoint tools must refresh current facts.",
        },
        reflection: {
          observationTokens: 36_000,
          providerOptions: env.modelProviderOptions,
          bufferActivation: 0.5,
          instruction:
            "Consolidate durable personal preferences and goals. Remove financial facts, provider entity IDs, tool names, tool outputs, and implementation details. Keep YNAB authoritative for budgeting and Trading212 authoritative for investments.",
        },
      },
    },
  }),
});
