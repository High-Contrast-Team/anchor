import { dayIndex } from '../core/clock';
import { lines } from '../core/lines';
import type { Feature, State } from '../core/types';
import { flush } from './capture/capture';
import { TIME, nextLocal } from './reminders/rules';

// the clock is global, so a reset clears the markers of the undone days in every family: the stage jump then lands on a day that fires again
function forgetUndoneDays(state: State, now: number) {
  const today = dayIndex(now);
  for (const family of state.families) {
    if ((family.lastMemoryDay ?? 0) > today) family.lastMemoryDay = undefined;
    for (const member of family.members) {
      if ((member.lastInvitationDay ?? 0) > today) member.lastInvitationDay = undefined;
      if ((member.lastCallDay ?? 0) > today) member.lastCallDay = undefined;
      if ((member.seenAt ?? 0) > now) member.seenAt = undefined;
    }
  }
}

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
    // "now" undoes the rehearsal jumps; the gap to the real clock also covers a short demo day on the dev bot
    const reset = argument === 'now';
    const days = /^\d+$/.test(argument) ? Number(argument) : 0;
    if (!clock && !reset && !(days >= 1 && days <= 400)) {
      await ctx.transport(family.id).send(event.chatId, { text: lines.fastforwardUsage, ...to });
      return true;
    }
    await flush(family, ctx);
    const now = ctx.now();
    ctx.store.state.clockOffset += reset ? Date.now() - now : clock ? nextLocal(now, argument) - now : days * 86_400_000;
    if (reset) forgetUndoneDays(ctx.store.state, ctx.now());
    ctx.store.save();
    // a jump to a clock time or back to now keeps the slots on the way quiet, and only the presenter sees it
    const quiet = clock || reset;
    if (quiet) ctx.restartWindow?.();
    const date = new Date(ctx.now()).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    await ctx.transport(family.id).send(event.chatId, { text: lines.fastforwarded(date), ...(quiet ? { onlyFor: event.sender.id } : to) });
    return true;
  },
};
