import fetch from 'node-fetch';

interface DirectLineActivity {
  type: string;
  from: { id: string; role?: string };
  text?: string;
}

interface DirectLineConversationResponse {
  conversationId: string;
  token?: string;
}

interface DirectLineActivitiesResponse {
  activities: DirectLineActivity[];
  watermark?: string;
}

/**
 * Sends a single-turn prompt to a Microsoft Copilot Studio bot via Direct Line.
 * Returns the bot's first text reply.
 *
 * @param endpoint - Direct Line base URL, e.g. https://directline.botframework.com/v3/directline
 *                   May include a token query parameter as provided by Copilot Studio.
 * @param prompt   - The text message to send to the bot.
 * @param timeoutMs - Max wait time for bot response (default 60 seconds).
 */
export async function callCopilotStudio(
  endpoint: string,
  prompt: string,
  timeoutMs = 60_000,
): Promise<string> {
  // Step 1: Start a conversation
  const convRes = await fetch(`${endpoint}/conversations`, { method: 'POST' });
  if (!convRes.ok) {
    throw new Error(
      `Copilot Studio: failed to start conversation (HTTP ${convRes.status})`,
    );
  }
  const conv = (await convRes.json()) as DirectLineConversationResponse;
  const { conversationId } = conv;

  const userId = `vtextstudio-user`;

  // Step 2: Send the prompt as a message activity
  const sendRes = await fetch(
    `${endpoint}/conversations/${conversationId}/activities`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        from: { id: userId },
        text: prompt,
      }),
    },
  );
  if (!sendRes.ok) {
    throw new Error(
      `Copilot Studio: failed to send message (HTTP ${sendRes.status})`,
    );
  }

  // Step 3: Poll for the bot's response
  const deadline = Date.now() + timeoutMs;
  let watermark: string | undefined;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));

    const pollUrl = watermark
      ? `${endpoint}/conversations/${conversationId}/activities?watermark=${watermark}`
      : `${endpoint}/conversations/${conversationId}/activities`;

    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) continue;

    const data = (await pollRes.json()) as DirectLineActivitiesResponse;
    watermark = data.watermark;

    const botReply = data.activities.find(
      a => a.type === 'message' && a.from.role === 'bot' && a.text,
    );
    if (botReply?.text) return botReply.text;
  }

  throw new Error('Copilot Studio: timed out waiting for bot response');
}
