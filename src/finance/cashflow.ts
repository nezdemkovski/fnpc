import { addMonths, monthStart, nextMonthStart, toMonthKey } from "./months";

export type ForecastRow = {
  month: string;
  openingFreeCashMinor: number;
  incomeMinor: number;
  recurringExpensesMinor: number;
  plannedExpensesMinor: number;
  actualExpensesMinor: number;
  savingsContributionsMinor: number;
  closingFreeCashMinor: number;
  protectedSavingsMinor: number;
  riskLevel: "ok" | "tight" | "negative";
  remainingObligations: ForecastObligationItem[];
};

export type ForecastObligationItem = {
  kind:
    | "recurring_expense"
    | "planned_expense"
    | "savings_contribution"
    | "scenario_expense";
  name: string;
  amountMinor: number;
  dueDate?: Date;
  calculation: "full" | "prorated";
};

export type CashflowIncomeRule = {
  id: string;
  amountMinor: number;
  frequency: string;
  expectedDayFrom?: number | null;
  defaultDay?: number | null;
};

export type CashflowIncomeEvent = {
  incomeRuleId?: string | null;
  amountMinor: number;
  expectedDate?: Date | null;
  status: string;
};

export type CashflowRecurringExpense = {
  name: string;
  amountMinor: number;
  frequency: string;
  dayOfMonth?: number | null;
};

export type CashflowPlannedExpense = {
  name?: string;
  amountMinor: number;
  plannedFor: Date;
};

export type CashflowActualExpense = {
  name: string;
  amountMinor: number;
  spentAt: Date;
};

export type CashflowSavingsRule = {
  type: string;
  amountMinor?: number | null;
  percentBps?: number | null;
  dayOfMonth?: number | null;
};

export type ForecastScenarioExpense = {
  name: string;
  amountMinor: number;
  plannedFor: Date;
};

export type CashflowInput = {
  now: Date;
  horizonMonths: number;
  openingFreeCashMinor: number;
  openingProtectedSavingsMinor: number;
  incomeRules: CashflowIncomeRule[];
  incomeEvents: CashflowIncomeEvent[];
  recurringExpenses: CashflowRecurringExpense[];
  plannedExpenses: CashflowPlannedExpense[];
  actualExpenses: CashflowActualExpense[];
  savingsRules: CashflowSavingsRule[];
  scenarioExpenses?: ForecastScenarioExpense[];
};

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

const riskLevel = (closingFreeCashMinor: number): ForecastRow["riskLevel"] => {
  if (closingFreeCashMinor < 0) return "negative";
  if (closingFreeCashMinor < 50_000_00) return "tight";
  return "ok";
};

const clampDayOfMonth = (monthStartDate: Date, day: number): number =>
  Math.min(
    Math.max(day, 1),
    new Date(
      Date.UTC(
        monthStartDate.getUTCFullYear(),
        monthStartDate.getUTCMonth() + 1,
        0,
      ),
    ).getUTCDate(),
  );

const dateInMonth = (monthStartDate: Date, day: number): Date =>
  new Date(
    Date.UTC(
      monthStartDate.getUTCFullYear(),
      monthStartDate.getUTCMonth(),
      clampDayOfMonth(monthStartDate, day),
    ),
  );

const utcDayStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const prorateRemainingInMonth = (
  amountMinor: number,
  monthStartDate: Date,
  periodStart: Date,
): number => {
  if (periodStart <= monthStartDate) return amountMinor;

  const daysInMonth = new Date(
    Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const currentDay = Math.min(Math.max(periodStart.getUTCDate(), 1), daysInMonth);
  const remainingDaysInclusive = daysInMonth - currentDay + 1;

  return Math.round((amountMinor * remainingDaysInclusive) / daysInMonth);
};

const normalizeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const expenseLooksPaid = ({
  name,
  amountMinor,
  actuals,
}: {
  name: string;
  amountMinor: number;
  actuals: CashflowActualExpense[];
}): boolean => {
  const normalizedName = normalizeName(name);
  return actuals.some((actual) => {
    if (actual.amountMinor !== amountMinor) return false;
    const normalizedActual = normalizeName(actual.name);
    return (
      normalizedActual === normalizedName ||
      normalizedActual.includes(normalizedName) ||
      normalizedName.includes(normalizedActual)
    );
  });
};

export const buildCashflowForecastRows = ({
  now,
  horizonMonths,
  openingFreeCashMinor,
  openingProtectedSavingsMinor,
  incomeRules,
  incomeEvents,
  recurringExpenses,
  plannedExpenses,
  actualExpenses,
  savingsRules,
  scenarioExpenses = [],
}: CashflowInput): ForecastRow[] => {
  const startMonth = toMonthKey(now);
  let freeCashMinor = openingFreeCashMinor;
  let protectedSavingsMinor = openingProtectedSavingsMinor;
  const rows: ForecastRow[] = [];

  for (let index = 0; index < horizonMonths; index += 1) {
    const month = addMonths(startMonth, index);
    const from = monthStart(month);
    const to = nextMonthStart(month);
    const periodStart = index === 0 ? utcDayStart(now) : from;
    const monthPlans = plannedExpenses.filter(
      (expense) => expense.plannedFor >= from && expense.plannedFor < to,
    );
    const monthActuals = actualExpenses.filter(
      (expense) => expense.spentAt >= from && expense.spentAt < to,
    );
    const monthIncomeEvents = incomeEvents.filter(
      (event) =>
        (event.status === "planned" || event.status === "received") &&
        event.expectedDate &&
        event.expectedDate >= from &&
        event.expectedDate < to,
    );
    const matchingScenarioExpenses = scenarioExpenses.filter(
      (expense) => expense.plannedFor >= periodStart && expense.plannedFor < to,
    );
    const plannedIncomeEventsMinor = sum(
      monthIncomeEvents
        .filter(
          (event) =>
            event.status === "planned" &&
            event.expectedDate &&
            event.expectedDate >= periodStart,
        )
        .map((event) => event.amountMinor),
    );
    const eventRuleIds = new Set(
      monthIncomeEvents
        .filter((event) => event.incomeRuleId)
        .map((event) => event.incomeRuleId),
    );
    const ruleIncomeMinor = sum(
      incomeRules
        .filter((rule) => rule.frequency === "monthly")
        .filter((rule) => !eventRuleIds.has(rule.id))
        .filter((rule) => {
          const dueDay = rule.defaultDay ?? rule.expectedDayFrom ?? 1;
          return dateInMonth(from, dueDay) >= periodStart;
        })
        .map((rule) => rule.amountMinor),
    );
    const recurringObligations: ForecastObligationItem[] = recurringExpenses
      .filter((expense) => expense.frequency === "monthly")
      .filter((expense) => {
        if (
          expenseLooksPaid({
            name: expense.name,
            amountMinor: expense.amountMinor,
            actuals: monthActuals,
          })
        ) {
          return false;
        }
        if (!expense.dayOfMonth) return true;
        return dateInMonth(from, expense.dayOfMonth) >= periodStart;
      })
      .map((expense) => {
        const isProrated = !expense.dayOfMonth && index === 0;
        return {
          kind: "recurring_expense" as const,
          name: expense.name,
          amountMinor: isProrated
            ? prorateRemainingInMonth(expense.amountMinor, from, periodStart)
            : expense.amountMinor,
          dueDate: expense.dayOfMonth
            ? dateInMonth(from, expense.dayOfMonth)
            : undefined,
          calculation: isProrated ? ("prorated" as const) : ("full" as const),
        };
      });
    const recurringExpensesMinor = sum(
      recurringObligations.map((obligation) => obligation.amountMinor),
    );
    const savingsObligations: ForecastObligationItem[] = savingsRules.flatMap(
      (rule) => {
        if (rule.type === "monthly_fixed") {
          if (rule.dayOfMonth && dateInMonth(from, rule.dayOfMonth) < periodStart)
            return [];
          const isProrated = !rule.dayOfMonth && index === 0;
          return [
            {
              kind: "savings_contribution" as const,
              name: "Savings contribution",
              amountMinor: isProrated
                ? prorateRemainingInMonth(rule.amountMinor ?? 0, from, periodStart)
                : rule.amountMinor ?? 0,
              dueDate: rule.dayOfMonth
                ? dateInMonth(from, rule.dayOfMonth)
                : undefined,
              calculation: isProrated ? ("prorated" as const) : ("full" as const),
            },
          ];
        }

        if (rule.type === "percentage_of_income") {
          if (rule.dayOfMonth && dateInMonth(from, rule.dayOfMonth) < periodStart)
            return [];
          const amountMinor = Math.round(
            ((ruleIncomeMinor + plannedIncomeEventsMinor) * (rule.percentBps ?? 0)) /
              10_000,
          );
          const isProrated = !rule.dayOfMonth && index === 0;
          return [
            {
              kind: "savings_contribution" as const,
              name: "Savings contribution",
              amountMinor: isProrated
                ? prorateRemainingInMonth(amountMinor, from, periodStart)
                : amountMinor,
              dueDate: rule.dayOfMonth
                ? dateInMonth(from, rule.dayOfMonth)
                : undefined,
              calculation: isProrated ? ("prorated" as const) : ("full" as const),
            },
          ];
        }

        return [];
      },
    );
    const savingsContributionsMinor = sum(
      savingsObligations.map((obligation) => obligation.amountMinor),
    );
    const plannedObligations: ForecastObligationItem[] = monthPlans.map((expense) => ({
      kind: "planned_expense",
      name: expense.name ?? "Planned expense",
      amountMinor: expense.amountMinor,
      dueDate: expense.plannedFor,
      calculation: "full",
    }));
    const scenarioObligations: ForecastObligationItem[] =
      matchingScenarioExpenses.map((expense) => ({
        kind: "scenario_expense",
        name: expense.name,
        amountMinor: expense.amountMinor,
        dueDate: expense.plannedFor,
        calculation: "full",
      }));
    const plannedExpensesMinor =
      sum(plannedObligations.map((expense) => expense.amountMinor)) +
      sum(scenarioObligations.map((expense) => expense.amountMinor));
    const actualExpensesMinor = 0;
    const incomeMinor = ruleIncomeMinor + plannedIncomeEventsMinor;
    const openingFreeCashMinor = freeCashMinor;
    const closingFreeCashMinor =
      openingFreeCashMinor +
      incomeMinor -
      recurringExpensesMinor -
      savingsContributionsMinor -
      plannedExpensesMinor -
      actualExpensesMinor;

    protectedSavingsMinor += savingsContributionsMinor;
    freeCashMinor = closingFreeCashMinor;

    rows.push({
      month,
      openingFreeCashMinor,
      incomeMinor,
      recurringExpensesMinor,
      plannedExpensesMinor,
      actualExpensesMinor,
      savingsContributionsMinor,
      closingFreeCashMinor,
      protectedSavingsMinor,
      riskLevel: riskLevel(closingFreeCashMinor),
      remainingObligations: [
        ...recurringObligations,
        ...plannedObligations,
        ...scenarioObligations,
        ...savingsObligations,
      ],
    });
  }

  return rows;
};
