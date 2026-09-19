import { Injectable } from '@nestjs/common';
import { RouteDecision } from './router.types';

@Injectable()
export class RouterService {
  route(text: string): RouteDecision {
    const raw = String(text ?? '');
    const t = raw.trim().toLowerCase();

    console.log('[ROUTER] input(raw)=', JSON.stringify(raw));
    console.log('[ROUTER] input(trim)=', JSON.stringify(t));

    // ✅ MVP dev commands for testing tool_call loop
    // Accept:
    // - tool:test
    // - tool:call
    // - tool : test  (with spaces)
    // - tool : call
    if (this.isToolDevCommand(t)) {
      return {
        intent: 'tool_test',
        confidence: 1,
        toolCalls: [{ name: 'noop.test', args: {} }],
        draftReply: 'دارم ابزار تست را اجرا می‌کنم…',
      };
    }

    // remember
    if (/^(یادم باشه|remember)\b/i.test(t)) {
      const content =
        t.replace(/^(یادم باشه|remember)\s*[:：]?\s*/i, '').trim() || t;
      return {
        intent: 'remember',
        confidence: 0.8,
        toolCalls: [{ name: 'memory.write', args: { type: 'note', content } }],
      };
    }

    // recall
    if (/(چی یادداشت|یادداشت|note|recall|یادم چی)/i.test(t)) {
      const q =
        t.replace(/چی یادداشت|یادداشت|note|recall|یادم چی/gi, '').trim() || t;
      return {
        intent: 'recall',
        confidence: 0.7,
        toolCalls: [{ name: 'memory.search', args: { q, limit: 5 } }],
      };
    }

    // action placeholder (later tools)
    if (/(بساز|ایجاد کن|create|schedule|یادآوری)/i.test(t)) {
      return {
        intent: 'action',
        confidence: 0.5,
        toolCalls: [{ name: 'action.todo_placeholder', args: { text: t } }],
        draftReply: 'باشه، برای انجامش نیاز دارم ابزار مربوطه را اضافه کنیم.',
      };
    }

    // chat fallback
    return {
      intent: 'chat',
      confidence: 0.6,
      toolCalls: [],
      draftReply: 'باشه. (فعلاً در MVP پاسخ‌گویی چتی را ساده نگه می‌داریم.)',
    };
  }

  private isToolDevCommand(t: string): boolean {
    // normalize spaces around ":" too
    // examples:
    // "tool:test" => "tool:test"
    // "tool : test" => "tool:test"
    const normalized = t.replace(/\s*/g, ''); // remove all whitespace
    return (
      normalized === 'tool:test' ||
      normalized === 'tool:call' ||
      normalized.startsWith('tool:test') ||
      normalized.startsWith('tool:call')
    );
  }
}
