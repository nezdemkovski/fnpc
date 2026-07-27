import {
  toTrading212GatewayError,
} from "../../../trading212/gateway";

export const trading212ReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const trading212ReportAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const executeTrading212Endpoint = async <T>(
  endpoint: string,
  request: () => Promise<T>,
) => {
  try {
    return {
      ok: true as const,
      source: "Trading212" as const,
      endpoint,
      fetchedAt: new Date().toISOString(),
      data: await request(),
    };
  } catch (error) {
    const trading212Error = toTrading212GatewayError(error);
    return {
      ok: false as const,
      source: "Trading212" as const,
      endpoint,
      error: trading212Error.code,
      status: trading212Error.status,
    };
  }
};
