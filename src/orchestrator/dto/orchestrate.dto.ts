import {
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export type Channel = 'telegram' | 'web' | 'app' | 'unknown';
export type ChannelLike = Channel | (string & {});
export class OrchestrateRequestDto {
  @IsString() channel!: ChannelLike;
  @IsString() userId!: string; // e.g. "tg:123"
  @IsString() conversationId!: string; // e.g. "tg:123" or thread id
  @IsString() text!: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, any>;
}

export class ToolCallDto {
  @IsString() name!: string; // e.g. "memory.write"
  @IsObject() args!: Record<string, any>;
  @IsOptional() @IsString() id?: string; // optional tool call id
}

export type OrchestrateResponseType =
  | 'reply'
  | 'tool_call'
  | 'needs_confirmation';

export class PendingActionDto {
  @IsString() id!: string;
  @IsObject() toolCall!: ToolCallDto;
}

export class OrchestrateResponseDto {
  @IsString() type!: OrchestrateResponseType;
  @IsString() replyText!: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ToolCallDto)
  @IsArray()
  toolCalls?: ToolCallDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PendingActionDto)
  pendingAction?: PendingActionDto;

  @IsOptional()
  @IsObject()
  debug?: Record<string, any>;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class ToolResultItemDto {
  @IsString() name!: string;
  @IsBoolean() ok!: boolean;

  @IsOptional() @IsObject() data?: any;
  @IsOptional() @IsString() error?: string;
}

export class ToolResultDto {
  @IsString() userId!: string;
  @IsString() conversationId!: string;
  @IsString() correlationId!: string;

  @ValidateNested({ each: true })
  @Type(() => ToolResultItemDto)
  @IsArray()
  results!: ToolResultItemDto[];
}

export class ConfirmDto {
  @IsString() userId!: string;
  @IsString() conversationId!: string;
  @IsString() pendingActionId!: string;
  @IsBoolean() approved!: boolean;
}
