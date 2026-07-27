import { z } from "zod";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const braveWebResultSchema = z
  .object({
    title: z.string(),
    url: z.url(),
    description: z.string(),
    age: z.string().optional(),
    page_age: z.string().optional(),
    language: z.string().optional(),
    family_friendly: z.boolean().optional(),
    extra_snippets: z.array(z.string()).optional(),
  })
  .passthrough();

export const braveWebSearchResponseSchema = z
  .object({
    type: z.literal("search"),
    query: z
      .object({
        original: z.string(),
      })
      .passthrough()
      .nullable()
      .optional(),
    web: z
      .object({
        results: z.array(braveWebResultSchema),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type BraveWebSearchResponse = z.infer<
  typeof braveWebSearchResponseSchema
>;

const braveErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

type BraveSearchErrorCode =
  | "authentication_failed"
  | "rate_limited"
  | "invalid_request"
  | "invalid_response"
  | "search_unavailable";

export class BraveSearchError extends Error {
  constructor(
    readonly code: BraveSearchErrorCode,
    readonly status?: number,
  ) {
    super(`Brave Search request failed: ${code}`);
    this.name = "BraveSearchError";
  }
}

const responseError = async (response: Response) => {
  const providerError = braveErrorResponseSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  const invalidSubscriptionToken =
    providerError.success &&
    providerError.data.error.code === "SUBSCRIPTION_TOKEN_INVALID";

  return new BraveSearchError(
    response.status === 401 ||
      response.status === 403 ||
      invalidSubscriptionToken
      ? "authentication_failed"
      : response.status === 429
        ? "rate_limited"
        : response.status >= 500
          ? "search_unavailable"
          : "invalid_request",
    response.status,
  );
};

export class BraveSearchClient {
  constructor(
    private readonly options: {
      apiKey?: string;
      fetch?: Fetcher;
    },
  ) {}

  async search(query: string): Promise<BraveWebSearchResponse> {
    if (!this.options.apiKey) {
      throw new Error("BRAVE_SEARCH_API_KEY is required");
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);

    let response: Response;
    try {
      const fetcher: Fetcher = this.options.fetch ?? globalThis.fetch;
      response = await fetcher(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.options.apiKey,
        },
      });
    } catch {
      throw new BraveSearchError("search_unavailable");
    }

    if (!response.ok) throw await responseError(response);

    const result = braveWebSearchResponseSchema.safeParse(await response.json());
    if (!result.success) {
      throw new BraveSearchError("invalid_response", response.status);
    }

    return result.data;
  }
}
