import { insertOrQueue, newId } from "./offlineQueue";

export type CoachMessage = { role: "user" | "assistant"; content: string };

/** Keep recent exchanges within the endpoint's 40-message limit. */
export function coachContext(history: CoachMessage[], prompt: CoachMessage): CoachMessage[] {
  return [...history.slice(-38), prompt];
}

export function assistantReply(userId: string, conversationId: string, content: string) {
  return { id: newId(), user_id: userId, conversation_id: conversationId, role: "assistant", content };
}

export const saveAssistantReply = (reply: ReturnType<typeof assistantReply>) =>
  insertOrQueue("coach_messages", reply);
