import type { ToolExecutionContext } from "@mastra/core/tools";

export const resourceIdFromContext = (context?: ToolExecutionContext) =>
  context?.agent?.resourceId;

const latestTelegramMessageIdFromContext = (
  context?: ToolExecutionContext,
) => {
  const messages = context?.agent?.messages;
  if (!Array.isArray(messages)) return undefined;

  for (const message of [...messages].reverse()) {
    const metadata =
      message?.providerMetadata ?? message?.experimental_providerMetadata;
    const telegram = metadata?.mastra?.channels?.telegram;
    if (typeof telegram?.messageId === "string") return telegram.messageId;
  }

  return undefined;
};

export const sourceContext = (context?: ToolExecutionContext) => ({
  mastraResourceId: resourceIdFromContext(context),
  sourceMessageId: latestTelegramMessageIdFromContext(context),
});
