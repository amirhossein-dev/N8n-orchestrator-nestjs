import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export const CONTRACT_VERSION_V1 = '1.0' as const;

export type Channel = 'telegram' | 'web' | 'app' | 'unknown';

export class EnvelopeMetaDto {
  @IsOptional() @IsString() messageId?: string;
  @IsOptional() @IsString() timestamp?: string; // یا number اگر خواستی
  @IsOptional() @IsString() from?: string;

  // اگر می‌خوای meta کاملاً آزاد باشد، این DTO را حذف کن و Record بگذار.
}

export class OrchestrateRequestV1Dto {
  @IsString()
  @IsIn([CONTRACT_VERSION_V1])
  version!: typeof CONTRACT_VERSION_V1;

  @IsString()
  requestId!: string; // uuid

  @IsString()
  @IsIn(['telegram', 'web', 'app', 'unknown'])
  channel!: Channel;

  @IsString()
  userId!: string; // "tg:123"

  @IsString()
  conversationId!: string;

  @IsString()
  text!: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, any>;
}

export class ToolCallV1Dto {
  @IsString()
  name!: string;

  @IsObject()
  args!: Record<string, any>;

  @IsString()
  idempotencyKey!: string; // uuid (برای side-effect ها حیاتی)

  @IsOptional()
  @IsString()
  toolCallId?: string; // optional internal ID
}

export class PendingActionV1Dto {
  @IsString()
  id!: string;

  @ValidateNested()
  @Type(() => ToolCallV1Dto)
  toolCall!: ToolCallV1Dto;
}

export type OrchestrateResponseType =
  | 'reply'
  | 'tool_call'
  | 'needs_confirmation';

export class OrchestrateResponseV1Dto {
  @IsString()
  @IsIn([CONTRACT_VERSION_V1])
  version!: typeof CONTRACT_VERSION_V1;

  @IsString()
  requestId!: string;

  @IsString()
  @IsIn(['reply', 'tool_call', 'needs_confirmation'])
  type!: OrchestrateResponseType;

  @IsString()
  replyText!: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ToolCallV1Dto)
  @IsArray()
  toolCalls?: ToolCallV1Dto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PendingActionV1Dto)
  pendingAction?: PendingActionV1Dto;

  @IsOptional()
  @IsObject()
  debug?: Record<string, any>;
}

export class ToolResultItemV1Dto {
  @IsString()
  name!: string;

  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsObject()
  data?: any;

  @IsOptional()
  @IsString()
  error?: string;
}

export class ToolResultV1Dto {
  @IsString()
  @IsIn([CONTRACT_VERSION_V1])
  version!: typeof CONTRACT_VERSION_V1;

  @IsString()
  requestId!: string;

  @IsString()
  userId!: string;

  @IsString()
  conversationId!: string;

  @ValidateNested({ each: true })
  @Type(() => ToolResultItemV1Dto)
  @IsArray()
  results!: ToolResultItemV1Dto[];
}

export class ConfirmV1Dto {
  @IsString()
  @IsIn([CONTRACT_VERSION_V1])
  version!: typeof CONTRACT_VERSION_V1;

  @IsString()
  requestId!: string;

  @IsString()
  userId!: string;

  @IsString()
  conversationId!: string;

  @IsString()
  pendingActionId!: string;

  @IsBoolean()
  approved!: boolean;
}
