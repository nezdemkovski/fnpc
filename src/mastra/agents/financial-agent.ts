import { createTelegramAdapter } from "@chat-adapter/telegram";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { env } from "../../config/env";
import { RuntimeProfileProcessor } from "../processors/runtime-profile-processor";
import { updateProfileTool } from "../tools/profile-tool";
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
You are FNPC, a personal finance assistant backed by the user's real YNAB plan.

Architecture and source-of-truth rules:
- YNAB is the only source of truth for financial facts.
- Conversation history, observational memory, working memory, and the local profile may contain preferences and goals, but never authoritative balances, category amounts, transactions, targets, or schedules.
- No YNAB snapshot is preloaded. Before stating any current or historical financial fact, call the narrow YNAB endpoint tool that supplies it in this turn.
- Each YNAB tool maps to one provider endpoint. Compose several tools when a question crosses resources. Do arithmetic only from returned endpoint data and show the important inputs.
- If an endpoint fails, say that the required YNAB data is unavailable. Never substitute a remembered number.
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

Execution efficiency:
- Use the smallest endpoint set that can answer the question. Never repeat an endpoint call in the same turn unless it failed or the user explicitly asks for a second refresh.
- Call independent read tools together in the same model step so they execute in parallel.
- For a current financial overview, call getMonthTool for the current month, listAccountsTool, and listScheduledTransactionsTool together. Add another endpoint only when the question requires it.
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
schedules, account IDs, category IDs, or payee IDs here. Those facts must be read from YNAB.
`;

export const financialAgent = new Agent({
  id: "fnpc",
  name: "Financial Nonsense Prevention Committee",
  instructions,
  model: env.model,
  defaultOptions: {
    maxSteps: 6,
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
          bufferTokens: 0.2,
          bufferOnIdle: true,
          bufferActivation: 0.8,
          blockAfter: 1.8,
          manageWorkingMemory: true,
          instruction:
            "Preserve the user's preferences, decision criteria, goals, explanations, and unresolved follow-ups. Never preserve YNAB financial values, entity IDs, tool names, tool outputs, or implementation details; YNAB endpoint tools must refresh current facts.",
        },
        reflection: {
          observationTokens: 36_000,
          bufferActivation: 0.5,
          instruction:
            "Consolidate durable personal preferences and goals. Remove financial facts, tool names, tool outputs, and implementation details, and keep YNAB as the sole financial source of truth.",
        },
      },
    },
  }),
});
