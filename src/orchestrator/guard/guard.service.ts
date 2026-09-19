import { Injectable } from '@nestjs/common';
import { GuardDecision } from './guard.types';
import { ToolCall } from '../tools/tool.types';

@Injectable()
export class GuardService {
  evaluate(toolCall: ToolCall): GuardDecision {
    const name = toolCall.name;

    // always allow memory
    if (name === 'memory.write' || name === 'memory.search') {
      return { kind: 'allow' };
    }

    // ✅ allow our MVP integration test tool
    if (name === 'noop.test') {
      return { kind: 'allow' };
    }

    // confirm sensitive tools
    if (
      name.startsWith('gmail.') ||
      name.startsWith('payments.') ||
      name.startsWith('delete.')
    ) {
      return {
        kind: 'confirm',
        reason: 'این عملیات حساس است و نیاز به تایید دارد.',
      };
    }

    // deny everything else
    return { kind: 'deny', reason: `Tool "${name}" در MVP مجاز/ثبت نشده است.` };
  }
}
