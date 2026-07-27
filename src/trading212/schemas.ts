import { z } from "zod";

const instrumentSchema = z
  .object({
    currency: z.string(),
    isin: z.string(),
    name: z.string(),
    ticker: z.string(),
  })
  .passthrough();

const orderSchema = z
  .object({
    createdAt: z.string(),
    currency: z.string(),
    extendedHours: z.boolean(),
    filledQuantity: z.number().nullish(),
    filledValue: z.number().nullish(),
    id: z.number().int(),
    initiatedFrom: z.string(),
    instrument: instrumentSchema,
    limitPrice: z.number().nullish(),
    quantity: z.number().nullish(),
    side: z.string(),
    status: z.string(),
    stopPrice: z.number().nullish(),
    strategy: z.string(),
    ticker: z.string(),
    timeInForce: z.string().nullish(),
    type: z.string(),
    value: z.number().nullish(),
  })
  .passthrough();

const fillSchema = z
  .object({
    filledAt: z.string(),
    id: z.number().int(),
    price: z.number(),
    quantity: z.number(),
    tradingMethod: z.string(),
    type: z.string(),
    walletImpact: z
      .object({
        currency: z.string(),
        fxRate: z.number(),
        netValue: z.number(),
        realisedProfitLoss: z.number(),
        taxes: z.array(z.record(z.string(), z.unknown())),
      })
      .passthrough(),
  })
  .passthrough();

export const accountSummarySchema = z
  .object({
    cash: z
      .object({
        availableToTrade: z.number(),
        inPies: z.number(),
        reservedForOrders: z.number(),
      })
      .passthrough(),
    currency: z.string(),
    id: z.number().int(),
    investments: z
      .object({
        currentValue: z.number(),
        realizedProfitLoss: z.number(),
        totalCost: z.number(),
        unrealizedProfitLoss: z.number(),
      })
      .passthrough(),
    totalValue: z.number(),
  })
  .passthrough();

export const positionsSchema = z.array(
  z
    .object({
      averagePricePaid: z.number(),
      createdAt: z.string(),
      currentPrice: z.number(),
      instrument: instrumentSchema,
      quantity: z.number(),
      quantityAvailableForTrading: z.number(),
      quantityInPies: z.number(),
      walletImpact: z
        .object({
          currency: z.string(),
          currentValue: z.number(),
          fxImpact: z
            .number()
            .nullish()
            .transform((value) => value ?? undefined),
          totalCost: z.number(),
          unrealizedProfitLoss: z.number(),
        })
        .passthrough(),
    })
    .passthrough(),
);

export const ordersSchema = z.array(orderSchema);
export const orderResponseSchema = orderSchema;

const historicalOrderSchema = z
  .object({
    fill: fillSchema.nullish(),
    order: orderSchema,
  })
  .passthrough();

const dividendSchema = z
  .object({
    amount: z.number(),
    amountInEuro: z.number().nullish(),
    currency: z.string(),
    grossAmountPerShare: z.number(),
    instrument: instrumentSchema,
    paidOn: z.string(),
    quantity: z.number(),
    reference: z.string(),
    ticker: z.string(),
    tickerCurrency: z.string(),
    type: z.string(),
  })
  .passthrough();

const transactionSchema = z
  .object({
    amount: z.number(),
    currency: z.string(),
    dateTime: z.string(),
    reference: z.string(),
    type: z.string(),
  })
  .passthrough();

const pageSchema = <T extends z.ZodType>(itemSchema: T) =>
  z
    .object({
      items: z.array(itemSchema),
      nextPagePath: z.string().nullish(),
    })
    .passthrough();

export const historicalOrdersSchema = pageSchema(historicalOrderSchema);
export const dividendsSchema = pageSchema(dividendSchema);
export const transactionsSchema = pageSchema(transactionSchema);

export const reportsSchema = z.array(
  z
    .object({
      dataIncluded: z
        .object({
          includeDividends: z.boolean(),
          includeInterest: z.boolean(),
          includeOrders: z.boolean(),
          includeTransactions: z.boolean(),
        })
        .passthrough(),
      downloadLink: z.string().nullish(),
      reportId: z.number().int(),
      status: z.string(),
      timeFrom: z.string(),
      timeTo: z.string(),
    })
    .passthrough(),
);

export const requestedReportSchema = z
  .object({ reportId: z.number().int() })
  .passthrough();

export const instrumentsSchema = z.array(
  z
    .object({
      addedOn: z.string(),
      currencyCode: z.string(),
      extendedHours: z.boolean(),
      isin: z.string(),
      maxOpenQuantity: z.number(),
      name: z.string(),
      shortName: z.string(),
      ticker: z.string(),
      type: z.string(),
      workingScheduleId: z.number().int(),
    })
    .passthrough(),
);

export const exchangesSchema = z.array(
  z
    .object({
      id: z.number().int(),
      name: z.string(),
      workingSchedules: z.array(
        z
          .object({
            id: z.number().int(),
            timeEvents: z.array(z.record(z.string(), z.unknown())),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
);

export type Trading212AccountSummary = z.infer<
  typeof accountSummarySchema
>;
export type Trading212Position = z.infer<
  typeof positionsSchema
>[number];

export type ReportRequest = {
  timeFrom: string;
  timeTo: string;
  dataIncluded: {
    includeDividends: boolean;
    includeInterest: boolean;
    includeOrders: boolean;
    includeTransactions: boolean;
  };
};
