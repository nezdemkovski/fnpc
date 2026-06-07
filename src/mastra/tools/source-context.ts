import type { ToolExecutionContext } from "@mastra/core/tools";

export const resourceIdFromContext = (context?: ToolExecutionContext) =>
  context?.agent?.resourceId;

export const latestUserMessageFromContext = (context?: ToolExecutionContext) => {
  const messages = context?.agent?.messages;
  if (!Array.isArray(messages)) return undefined;

  for (const message of [...messages].reverse()) {
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map((part) => (part?.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text.length > 0) return text;
  }

  return undefined;
};

export const latestTelegramMessageIdFromContext = (
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
  sourceText: latestUserMessageFromContext(context),
});
