/** One recoverable AI operation per account and screen/plan. Never expire uncertain work. */
export interface AiIntent<Request, Result, Context> {
  id: string;
  request: Request;
  context: Context;
  result?: Result;
}
const keyFor = (userId: string, operation: string) => `vaylo_ai_intent:${userId}:${operation}`;

export function readAiIntent<Q, R, C>(userId: string, operation: string): AiIntent<Q, R, C> | null {
  const raw = localStorage.getItem(keyFor(userId, operation));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.id !== "string" || !value.request || !value.context) {
    throw new Error("The saved request could not be read. Contact support before generating again.");
  }
  return value;
}
export function writeAiIntent<Q, R, C>(userId: string, operation: string, intent: AiIntent<Q, R, C>): void {
  localStorage.setItem(keyFor(userId, operation), JSON.stringify(intent));
}
export function clearAiIntent(userId: string, operation: string, id: string): void {
  const current = readAiIntent(userId, operation);
  if (current?.id === id) localStorage.removeItem(keyFor(userId, operation));
}
