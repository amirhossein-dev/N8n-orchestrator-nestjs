export type ToolCall = { name: string; args: Record<string, any>; id?: string };

export type ToolExecutionResult =
  | { name: string; ok: true; data: any }
  | { name: string; ok: false; error: string };

export type ToolHandler = (ctx: {
  userId: string;
  conversationId: string;
  correlationId: string;
  args: Record<string, any>;
}) => Promise<ToolExecutionResult>;

export type ToolDefinition = {
  name: string;
  scope: 'core' | 'integration';
  description: string;
  handler?: ToolHandler; // core only
};
