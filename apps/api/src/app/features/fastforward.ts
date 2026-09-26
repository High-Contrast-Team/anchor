import { lines } from '../core/lines';
import type { Feature } from '../core/types';
import { flush } from './capture/capture';
import { TIME, nextLocal } from './reminders/rules';

export const fastforward: Feature = {
  name: 'fastforward',
  async handle(event, family, ctx) {
    if (event.chat !== 'group' || !family || !event.text || !/^\/fastforward(\s|$)/.test(event.text)) return false;
    // an ephemeral command has no message to reply to
    const to = event.ephemeral ? { onlyFor: event.sender.id } : { replyTo: event.messageId };
    if (!(await ctx.transport(family.id).isAdmin(event.chatId, event.sender.id))) {
      await ctx.transport(family.id).send(event.chatId, { text: lines.adminOnly, ...to });
      return true;
    }
    const argument = event.text.match(/^\/fastforward\s+(\S+)\s*$/)?.[1] ?? '';
    const clock = TIME.test(argument);
    const days = /^\d+$/.test(argument) ? Number(argument) : 0;
    if (!clock && !(days >= 1 && days <= 400)) {
      await ctx.transport(family.id).send(event.chatId, { text: lines.fastforwardUsage, ...to });
      return true;
    }
    await flush(family, ctx);
    const now = ctx.now();
    ctx.store.state.clockOffset += clock ? nextLocal(now, argument) - now : days * 86_400_000;
    ctx.store.save();
    // a jump to a clock time keeps the slots inside the jump quiet, and only the presenter sees it
    if (clock) ctx.restartWindow?.();
    const date = new Date(ctx.now()).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    await ctx.transport(family.id).send(event.chatId, { text: lines.fastforwarded(date), ...(clock ? { onlyFor: event.sender.id } : to) });
    return true;
  },
};
