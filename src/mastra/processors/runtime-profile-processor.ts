import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import { buildRuntimeContextMessage, getRuntimeProfile, resourceIdFromMessages } from "../runtime-profile";

export class RuntimeProfileProcessor implements Processor {
  readonly id = "runtime-profile";
  readonly name = "Runtime Profile";
  readonly description = "Injects durable user profile and current date context after channel memory is loaded.";

  async processInput({ messages, systemMessages }: ProcessInputArgs): Promise<ProcessInputResult> {
    const resourceId = resourceIdFromMessages(messages);
    const profile = await getRuntimeProfile(resourceId);

    return {
      messages,
      systemMessages: [
        ...systemMessages,
        {
          role: "system",
          content: buildRuntimeContextMessage(profile),
        },
      ],
    };
  }
}
