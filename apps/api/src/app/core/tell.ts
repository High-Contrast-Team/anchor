import { Logger } from '@nestjs/common';
import { speak } from '../model/model';
import { Blocked, type Context, type Family, type Media, type Member, type Outgoing } from './types';

const logger = new Logger('Tell');

export const VOICE_STYLE = 'warm, calm and slow, like a kind family friend talking to a grandparent';

// a line with a picture, a voice note, an album, or a contact goes out as it is
const spoken = (message: Outgoing) => (message.photo || message.video || message.voice || message.album || message.contact ? undefined : message.text);

// v2, section 4.14: every private line goes through tell, and a member with the voice choice hears each text line; `say` replaces the words
// that the voice says, and the text stays the caption
export async function tell(
  family: Family,
  member: Member,
  message: Outgoing,
  ctx: Context,
  say?: string,
): Promise<{ messageId: string; voice?: Media } | undefined> {
  const transport = ctx.transport(family.id);
  const text = member.choices.voice && spoken(message) ? (say ?? spoken(message)) : undefined;
  try {
    if (text) {
      try {
        return await transport.send(member.id, { ...message, voice: { wav: await speak(text, VOICE_STYLE) } });
      } catch (error) {
        if (error instanceof Blocked) throw error;
        logger.warn(`The voice of a line to member ${member.id} failed, so the text goes out: ${error}`);
      }
    }
    return await transport.send(member.id, message);
  } catch (error) {
    if (error instanceof Blocked) {
      member.started = false;
      ctx.store.save();
    } else {
      logger.warn(`A message to member ${member.id} failed: ${error}`);
    }
    return undefined;
  }
}
