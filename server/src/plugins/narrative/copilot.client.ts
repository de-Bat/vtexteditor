import { CopilotClient, approveAll } from '@github/copilot-sdk';

const TAG = '[copilot]';

/** Default timeout: 5 minutes. Large transcripts produce long prompts. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Sends a single-turn prompt to GitHub Copilot via the @github/copilot-sdk.
 * Requires GH_TOKEN or GITHUB_TOKEN env var and the Copilot CLI installed.
 *
 * @param prompt      - The text prompt to send.
 * @param model       - The model to use (default: 'gpt-4.1').
 * @param timeoutMs   - Response timeout in ms (default: 300000 / 5 min).
 */
export async function callCopilotStudio(
  prompt: string,
  model = 'gpt-4.1',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onChunk?: (text: string) => void,
): Promise<string> {
  console.log(`${TAG} model=${model}  prompt=${prompt.length} chars  timeout=${timeoutMs / 1000}s`);
  const client = new CopilotClient();
  try {
    console.log(`${TAG} creating session…`);
    const session = await client.createSession({ model, onPermissionRequest: approveAll });
    console.log(`${TAG} session ready — sending prompt`);

    if (onChunk) {
      session.on('assistant.message_delta', (event) => {
        onChunk(event.data.deltaContent);
      });
    }

    const response = await session.sendAndWait({ prompt }, timeoutMs);
    const content = response?.data.content ?? '';
    console.log(`${TAG} response received — ${content.length} chars`);
    return content;
  } finally {
    await client.stop();
  }
}
