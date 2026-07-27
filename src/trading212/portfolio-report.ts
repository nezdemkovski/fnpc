import type { Trading212Gateway } from "./gateway";
import type {
  Trading212AccountSummary,
  Trading212Position,
} from "./schemas";

export const trading212PortfolioSchemaVersion = 1;

export type Trading212PortfolioPeriod = {
  from: string | null;
  to: string | null;
};

type PortfolioReportOptions = {
  from?: string;
  to?: string;
  includeRaw?: boolean;
};

type PortfolioGateway = Pick<
  Trading212Gateway,
  "getAccountSummary" | "getPositions"
>;

const round = (value: number, places: number) => {
  const power = 10 ** places;
  const scaled = value * power;
  const rounded =
    scaled >= 0
      ? Math.floor(scaled + 0.5)
      : Math.ceil(scaled - 0.5);
  return rounded / power;
};

const percentToBasisPoints = (percentage: number) =>
  round(percentage * 100, 0);

const allocationPercentage = (value: number, total: number) =>
  total <= 0 ? 0 : (value / total) * 100;

const holdingsReturn = (profitLoss: number, cost: number) =>
  cost <= 0 ? 0 : (profitLoss / cost) * 100;

const reportTimestamp = (date: Date) =>
  date.toISOString().replace(/\.\d{3}Z$/, "Z");

const reportDate = (date: Date) => date.toISOString().slice(0, 10);

const periodFrom = ({
  from,
  to,
}: PortfolioReportOptions): Trading212PortfolioPeriod => ({
  from: from ?? null,
  to: to ?? null,
});

const sum = (
  positions: Trading212Position[],
  value: (position: Trading212Position) => number,
) => positions.reduce((total, position) => total + value(position), 0);

export class Trading212PortfolioReportService {
  constructor(
    private readonly gateway: PortfolioGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getReport(options: PortfolioReportOptions = {}) {
    const accountSummary = await this.gateway.getAccountSummary();
    const positions = await this.gateway.getPositions();

    return buildTrading212PortfolioReport({
      accountSummary,
      positions,
      period: periodFrom(options),
      generatedAt: this.now(),
      includeRaw: options.includeRaw ?? false,
    });
  }
}

export const buildTrading212PortfolioReport = ({
  accountSummary,
  positions,
  period,
  generatedAt,
  includeRaw,
}: {
  accountSummary: Trading212AccountSummary;
  positions: Trading212Position[];
  period: Trading212PortfolioPeriod;
  generatedAt: Date;
  includeRaw: boolean;
}) => {
  const holdingsValue = sum(
    positions,
    (position) => position.walletImpact.currentValue,
  );
  const holdingsCost = sum(
    positions,
    (position) => position.walletImpact.totalCost,
  );
  const holdingsProfitLoss = sum(
    positions,
    (position) => position.walletImpact.unrealizedProfitLoss,
  );
  const hasCompleteFxImpact = positions.every(
    (position) => position.walletImpact.fxImpact !== undefined,
  );
  const holdingsFxImpact = hasCompleteFxImpact
    ? sum(positions, (position) => position.walletImpact.fxImpact ?? 0)
    : undefined;
  const holdingsProfitLossExcludingFx =
    holdingsFxImpact === undefined
      ? undefined
      : holdingsProfitLoss - holdingsFxImpact;

  const pieCash = accountSummary.cash.inPies;
  const allocated = holdingsValue + pieCash;
  const freeCash =
    accountSummary.cash.availableToTrade +
    accountSummary.cash.reservedForOrders;
  const returnPercentage = holdingsReturn(holdingsProfitLoss, holdingsCost);
  const allocation = positions
    .map((position) => {
      const percentage = allocationPercentage(
        position.walletImpact.currentValue,
        holdingsValue,
      );
      return {
        ticker: position.instrument.ticker,
        marketValue: position.walletImpact.currentValue,
        holdingsPct: round(percentage, 2),
        holdingsBps: percentToBasisPoints(percentage),
      };
    })
    .sort((left, right) => right.marketValue - left.marketValue);

  const holdings = positions
    .map((position) => {
      const percentage = allocationPercentage(
        position.walletImpact.currentValue,
        holdingsValue,
      );
      const fxPair =
        position.instrument.currency !== accountSummary.currency
          ? `${position.instrument.currency}/${accountSummary.currency}`
          : "";
      return {
        ticker: position.instrument.ticker,
        name: position.instrument.name,
        ...(position.instrument.isin
          ? { isin: position.instrument.isin }
          : {}),
        ...(position.createdAt ? { openedAt: position.createdAt } : {}),
        qty: position.quantity,
        tradableQty: position.quantityAvailableForTrading,
        qtyInPies: position.quantityInPies,
        instrumentCurrency: position.instrument.currency,
        avgPricePaid: position.averagePricePaid,
        currentPrice: position.currentPrice,
        accountCurrency: accountSummary.currency,
        invested: position.walletImpact.totalCost,
        marketValue: position.walletImpact.currentValue,
        unrealizedPnL: position.walletImpact.unrealizedProfitLoss,
        ...(position.walletImpact.fxImpact === undefined
          ? {}
          : { fxImpact: position.walletImpact.fxImpact }),
        ...(fxPair ? { fxPair } : {}),
        holdingsPct: round(percentage, 2),
        holdingsBps: percentToBasisPoints(percentage),
      };
    })
    .sort((left, right) => right.marketValue - left.marketValue);

  const rawAllocatedDifference =
    accountSummary.investments.currentValue - allocated;
  const rawAccountTotalDifference =
    accountSummary.totalValue - (freeCash + allocated);
  const allocatedDifference = round(rawAllocatedDifference, 2);
  const accountTotalDifference = round(rawAccountTotalDifference, 2);
  const warnings: string[] = [];
  if (Math.abs(rawAccountTotalDifference) > 0.01) {
    warnings.push(
      `account total does not reconcile (diff: ${accountTotalDifference.toFixed(2)} ${accountSummary.currency})`,
    );
  }
  if (Math.abs(rawAllocatedDifference) > 0.01) {
    warnings.push(
      `investments allocated does not reconcile (diff: ${allocatedDifference.toFixed(2)} ${accountSummary.currency})`,
    );
  }

  return {
    schemaVersion: trading212PortfolioSchemaVersion,
    report: {
      reportDate: reportDate(generatedAt),
      generatedAt: reportTimestamp(generatedAt),
      period,
    },
    summary: {
      currency: accountSummary.currency,
      derived: {
        holdingsValue,
        pieCash,
        allocated,
        freeCash,
        accountTotal: accountSummary.totalValue,
        holdingsCost,
        holdingsPnL: holdingsProfitLoss,
        ...(holdingsFxImpact === undefined
          ? {}
          : { holdingsFxImpact }),
        ...(holdingsProfitLossExcludingFx === undefined
          ? {}
          : { holdingsPnLExclFx: holdingsProfitLossExcludingFx }),
        holdingsReturnPct: round(returnPercentage, 4),
        holdingsReturnBps: percentToBasisPoints(returnPercentage),
        twrPctEst: round(returnPercentage, 4),
        twrBpsEst: percentToBasisPoints(returnPercentage),
        twrMethod: "holdings-only-no-flows",
        twrDescription:
          "Estimated TWR based on holdings only; excludes cash flows and pie allocations.",
      },
      snapshot: {
        apiInvestmentsValue: accountSummary.investments.currentValue,
        apiCashInPies: accountSummary.cash.inPies,
        apiCashAvailable: accountSummary.cash.availableToTrade,
        apiCashReserved: accountSummary.cash.reservedForOrders,
        apiRealizedPnL: accountSummary.investments.realizedProfitLoss,
        apiTotalCost: accountSummary.investments.totalCost,
        apiTotalValue: accountSummary.totalValue,
      },
      reconcile: {
        allocatedDiff: allocatedDifference,
        accountTotalDiff: accountTotalDifference,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    },
    allocation,
    holdings,
    ...(includeRaw
      ? { raw: { accountSummary, positions } }
      : {}),
  };
};
