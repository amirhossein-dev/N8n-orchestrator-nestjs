export type Intent = 'chat' | 'remember' | 'recall' | 'action' | 'tool_test';

export type RouteDecision = {
  intent: Intent;
  confidence: number;
  entities?: Record<string, any>;
  // tool calls the "brain" wants to run
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  // optional: a direct reply if no tools needed
  draftReply?: string;
};
