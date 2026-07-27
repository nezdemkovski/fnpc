import { describe, expect, test } from "bun:test";
import { BraveSearchClient, BraveSearchError } from "./brave";

describe("BraveSearchClient", () => {
  test("sends only the search query and preserves the typed API response", async () => {
    let requestUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    const client = new BraveSearchClient({
      apiKey: "test-key",
      fetch: async (input, init) => {
        requestUrl = new URL(input.toString());
        requestInit = init;
        return Response.json({
          type: "search",
          query: { original: "current mortgage rates" },
          web: {
            type: "search",
            results: [
              {
                title: "Mortgage rates",
                url: "https://example.com/rates",
                description: "Current rates and market context.",
                age: "2026-07-27T08:00:00Z",
                extra_snippets: ["Rates vary by lender."],
              },
            ],
          },
          news: { results: [{ title: "Rate decision" }] },
        });
      },
    });

    const result = await client.search("current mortgage rates");
    const capturedUrl = requestUrl as URL | undefined;
    if (!capturedUrl) throw new Error("Brave Search request was not captured");

    expect(capturedUrl.origin + capturedUrl.pathname).toBe(
      "https://api.search.brave.com/res/v1/web/search",
    );
    expect([...capturedUrl.searchParams.entries()]).toEqual([
      ["q", "current mortgage rates"],
    ]);
    expect(new Headers(requestInit?.headers).get("X-Subscription-Token")).toBe(
      "test-key",
    );
    expect(result.web?.results[0]).toMatchObject({
      title: "Mortgage rates",
      url: "https://example.com/rates",
      description: "Current rates and market context.",
    });
    expect(result.news).toEqual({
      results: [{ title: "Rate decision" }],
    });
  });

  test("maps provider failures without exposing response bodies or credentials", async () => {
    const client = new BraveSearchClient({
      apiKey: "secret-key",
      fetch: async () =>
        new Response('{"message":"secret-key is invalid"}', { status: 401 }),
    });

    const error = await client.search("query").catch((caught) => caught);

    expect(error).toBeInstanceOf(BraveSearchError);
    expect(error).toMatchObject({
      code: "authentication_failed",
      status: 401,
      message: "Brave Search request failed: authentication_failed",
    });
    expect(error.message).not.toContain("secret-key");
  });

  test("rejects malformed successful responses", async () => {
    const client = new BraveSearchClient({
      apiKey: "test-key",
      fetch: async () => Response.json({ type: "unexpected" }),
    });

    const error = await client.search("query").catch((caught) => caught);

    expect(error).toMatchObject({
      code: "invalid_response",
      status: 200,
    });
  });
});
