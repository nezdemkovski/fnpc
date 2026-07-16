import { toYnabGatewayError } from "../../../ynab/gateway";
import { z } from "zod";

export const monthSchema = z
  .string()
  .regex(/^(?:current|\d{4}-\d{2}-\d{2})$/)
  .describe('"current" or the first day of a month as YYYY-MM-DD');

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const executeYnabEndpoint = async <T>(
  endpoint: string,
  request: () => Promise<T>,
) => {
  try {
    return {
      ok: true as const,
      source: "YNAB" as const,
      endpoint,
      fetchedAt: new Date().toISOString(),
      data: await request(),
    };
  } catch (error) {
    const ynabError = toYnabGatewayError(error);
    return {
      ok: false as const,
      source: "YNAB" as const,
      endpoint,
      error: ynabError.code,
      status: ynabError.status,
    };
  }
};
