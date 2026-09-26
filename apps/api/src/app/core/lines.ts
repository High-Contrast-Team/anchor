import type { Moment } from './types';

const graphemes = new Intl.Segmenter();

/** Cuts the text to at most `max` UTF-16 units, the unit of the Telegram limits, and never inside an emoji. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = '';
  for (const { segment } of graphemes.segment(text)) {
    if (kept.length + segment.length > max) break;
    kept += segment;
  }
  return kept;
}

// keeps every caption under the Telegram limit of 1024 characters and the invitation voice note short
const clip = (text: string, max = 600) => (text.length > max ? `${cut(text, max - 1)}…` : text);

export function dateOf(moment: Moment): string {
  const date = moment.eventDate ? new Date(`${moment.eventDate}T12:00`) : new Date(moment.savedAt);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// a wordless moment names what was shared, so the model's title never reads as the sharer's words
function sharedBy(moment: Moment, max = 600): string {
  if (!moment.wordless) return `${moment.by.name} shared: «${clip(moment.text, max)}»`;
  const kind = moment.video ? 'a video' : !moment.photo && moment.voice ? 'a voice note' : 'a photo';
  return `${moment.by.name} shared ${kind}: ${moment.title}`;
}

// "Nikos", "Nikos and Eleni", or "Nikos, Eleni, and Maria"
const list = new Intl.ListFormat('en');
const and = (names: string[]) => list.format(names);

export type ChoiceName = 'moments' | 'reminders' | 'shares' | 'voice' | 'call';

export const lines = {
  intro:
    "Hi, I'm Anchor 👋 I'm not a person: I keep this family's photos and stories, each one in the words of the person who shared it. " +
    'When someone shares a moment worth keeping, I save it and react with ❤. Now and then I bring a moment back, so it stays with all of us. ' +
    'Tap the button to choose what I send you in private. ' +
    'Reply "Anchor, forget this" to delete a moment, or "Anchor, don\'t bring this back" to keep it without bringing it back. ' +
    'This is a test build, so please share staged photos only.',
  welcome: (name: string) =>
    `Hello ${name} 🙂 I'm Anchor. I'm not a person: I keep your family's photos and stories. ` +
    'I can send you family moments now and then, remind you of things, and talk to you by voice. ' +
    "Seeing moments again helps them stay with us. Tap what you'd like. You can change it at any time: just say \"settings\".",
  // v2, section 4.11: the join nudge, the choices screen, and the phone number
  nudge: (name: string) => `${name}, I can send you family moments, reminders, and voice notes in private. Tap to choose 🙂`,
  choicesScreen: 'Here is what I send you. Tap to change it 🙂',
  choice: (on: boolean, label: string) => `${on ? '✅' : '⬜'} ${label}`,
  // the short names of the choices, for choicesSaved
  choiceNames: { moments: 'family moments', reminders: 'reminders', shares: 'share offers', voice: 'voice notes', call: 'phone calls' } as Record<ChoiceName, string>,
  choicesSaved: (names: string[]) =>
    `${names.length ? `All set 💛 You get: ${and(names)}.` : "All set. I won't send you anything for now."} Say "settings" to change this.`,
  askPhone: 'To call you, I need your phone number. Tap the button below to share it 🙂',
  phoneSaved: "Thank you 💛 I call from this number, so you know it's me.",
  // v2, section 4.12: the share offers
  shareOffer: (names: string[]) => `Shall I send this to ${and(names)} now?`,
  shareSent: (names: string[]) => `Sent to ${and(names)} 💛`,
  // v2, section 4.6: the intents
  unclear: "I'm not sure I understood 🙂 Here is what I can do:",
  missed: (count: number) => `The family shared ${count} moments since we last talked 💛`,
  nothingNew: "You're up to date 💛 Nothing new since we last talked.",
  callFailed: "I couldn't ring you just now. Shall I send you a moment here instead?",
  sharedBy,
  // the private memory of the spike of 2026-09-26: an album of the week, then one message with the buttons
  weekLabel: 'This week in the family',
  weekMemory: (caption: string) => `This week in the family 💛\n${caption}`,
  weekShared: (moments: Moment[]) => `${and([...new Set(moments.map((moment) => moment.by.name))])} shared ${moments.length} moments.`,
  remindYou: 'What does it remind you of?',
  // the voice says the description after the sharer's words, so a member who cannot see the picture well hears what it shows
  spokenMoment: (moment: Moment) => [sharedBy(moment), moment.description].filter(Boolean).join('\n'),
  aboutMoments: (moments: Moment[], spoken = false) =>
    moments.flatMap((moment) => [`${sharedBy(moment, 120)} · ${dateOf(moment)}`, ...(spoken && moment.description ? [moment.description] : [])]).join('\n'),
  // the team writes the one-tap replies, so the model never puts words in the member's mouth
  familyReplies: [
    ['❤️', 'Sending my love'],
    ['😊', 'That made me smile'],
    ['💛', 'I miss you all'],
  ] as const,
  familyReply: (name: string, [emoji, words]: readonly [string, string]) => `${name}: «${words} ${emoji}»`,
  askCall: (name: string) => `Shall I ask ${name} to call you?`,
  done: {
    sent: '✅ Sent to the family',
    later: '✅ Another day, then',
    hidden: "✅ I won't show you these again",
    askedCall: (name: string) => `✅ Asked ${name} to call you`,
  },
  collectionReply: 'Reply to a photo to add your story.',
  // section 4.16: the fallback when the model writes no caption
  collectionCaption: (label: string, tag: string, moments: Moment[]) =>
    `${label} 💛\n${tag}, in ${moments.length} moments that ${and([...new Set(moments.map((moment) => moment.by.name))])} shared.\nReply to a photo to add your story.`,
  memoryCaption: (label: string, moment: Moment) =>
    `${label} 💛\n${sharedBy(moment)}\nReply with a story or a voice note to add it to the family record.`,
  labels: {
    '7': 'One week ago',
    '30': 'One month ago',
    '365': 'One year ago',
    anniversary: (year: number) => `On this day in ${year}`,
    fromRecord: 'From the family record',
  },
  gentleHelp: (date: string, title: string) => `No rush 🙂 This is from ${date}: ${title}. Any memory it brings is welcome.`,
  warmClose: 'Thank you 💛',
  stopped: 'Of course. I won\'t send you anything more. If you\'d like moments again, say "settings".',
  tellDirectly: (title: string, date: string, sender: string) => `This is ${title}, from ${date}. ${sender} shared it 💛`,
  thanks: 'Thank you for the story 💛 Shall I share it with the family?',
  shared: 'Done, the family can hear it now 💛',
  notShared: "Of course. I won't share it.",
  notNow: 'No problem 🙂 Another time.',
  storyAdded: (name: string, sender: string, story: string) => `${name} added a story to ${sender}'s moment 🎙️\n«${clip(story)}»`,
  echoCaption: (then: Moment, now: Moment) => `Then and now 💛\n${sharedBy(then, 450)}\n${sharedBy(now, 450)}`,
  fastforwarded: (date: string) => `⏩ It's now ${date} on the family clock.`,
  // v2, section 4.13: who is "You" when the sender gets the reminder
  reminderOffer: (who: string, text: string) => `⏰ ${who} wrote: «${clip(text)}»\nShall I remind you?`,
  reminderSet: (time: string) => `Done ✍ I'll remind you at ${time} in our private chat.`,
  reminderStart: (time: string) => `Tap Start, and I'll remind you at ${time} in our private chat 🙂`,
  reminderConfirmed: (time: string) => `Done ✍ I'll remind you here at ${time}.`,
  offersOff: `Of course. I won't offer that again. Say "settings" to change this.`,
  reminder: (who: string, text: string) => `⏰ Your reminder. ${who} wrote: «${clip(text)}»`,
  privateReminderOffer: (text: string) => `⏰ «${clip(text)}»\nWhen shall I remind you?`,
  // birthdays: a group message mentions one, and each member gets an offer in private
  birthdayOffer: (who: string, name: string, day: string) => `🎂 ${who} mentioned ${name}'s birthday on ${day}. Shall I remind you that morning?`,
  birthdaySet: (name: string, day: string) => `Done ✍ I'll remind you of ${name}'s birthday on ${day} at 09:00.`,
  birthdayToday: (name: string) => `🎂 Today is ${name}'s birthday.`,
  birthdaysThisMonth: (items: string[], reminded: boolean) =>
    `🎂 Birthdays this month:\n${items.map((item) => `• ${item}`).join('\n')}\n` +
    (reminded ? "I'll remind you at 09:00 on the day of each one still to come ✍" : 'They have all passed this month.'),
  noBirthdays: (next?: string) =>
    `I don't know of a birthday this month 🙂${next ? ` The next one I know: ${next}.` : ''} When someone mentions a birthday in the family group, I'll offer to remind you.`,
  fastforwardUsage: 'Send /fastforward and a number of days or a time, for example /fastforward 7 or /fastforward 08:05.',
  calling: "I'm ringing you now 📞",
  // v2, section 4.15: the phone call
  call: {
    opening: (name: string) => `Hello ${name}, this is Anchor, the family's record keeper. I'm not a person.`,
    askShare: 'Shall I share what you told me with the family?',
    askAnything: 'Ask me anything about the family.',
    reachPerson: (sender: string) => `Shall I tell ${sender} you'd love a call?`,
    connect: (sender: string) => `Shall I connect you to ${sender} now?`,
    connecting: (name: string, sender: string) => `Thank you, ${name}. I'm connecting you to ${sender} now. Goodbye 💛`,
    goodbye: (name: string) => `Thank you, ${name}. Goodbye 💛`,
  },
  wouldLoveCall: (name: string, sender: string) => `${sender}, ${name} would love a call from you 💛`,
  askAnswer: (title: string, date: string, names: string[]) =>
    `${title} · ${date} 💛${names.length ? `\nStories from ${names.join(', ')}` : ''}`,
  notFound: "I couldn't find that in the family record yet.",
  // an answer that fails the check against its sources gives way to this line and the moment itself
  recordSays: 'Here is what the family record says 💛',
  source: (moment: Moment) => `${sharedBy(moment)}\n${dateOf(moment)}`,
  pointer: "Hi! I keep your family's record. Talk to me in your family group 🙂",
  notInGroup: 'Hi! I talk only with the members of the family group. Ask your family to add you to the group, then tap the button again 🙂',
  // the scam shield: Anchor never says that a message is certainly a scam or certainly safe
  scam: {
    warning: (name?: string, hidden = false) =>
      `⚠️ ${name ? `${hidden ? "I can't see that this message came from" : 'This message did not come from'} ${name}'s Telegram account. ` : ''}` +
      `A message that asks for money, a code, or bank details in a hurry is a common scam. Before you answer, call ${name ?? 'the person'} on the number you know.`,
    fromAccount: (name: string) => `This message came from ${name}'s own Telegram account. If it asks for something unusual, call ${name} on the number you know.`,
    neutral: 'Thanks for showing me 🙂 If a message ever asks for money, a code, or a password, call the person on the number you know before you answer.',
    nameUsed: (sender: string) =>
      `${sender} got a message in your name that asked for money or a code. If you didn't send it, someone may be pretending to be you. A call to ${sender} would help 💛`,
    told: (name: string) => `Done, I told ${name} 💛`,
    notTold: (name: string) => `I couldn't reach ${name} just now. Please call ${name} on the number you know.`,
  },
  forgetWhich: 'This post shows two moments. Which one should I forget?',
  quietWhich: 'This post shows two moments. Which one should I stop bringing back?',
  whichMoment: (moment: Moment) => clip(`${moment.by.name}: ${moment.title}`, 40),
  voiceNote: '🎤 voice note',
  nothingToShare: 'The family record is empty so far. Share a photo with a few words 🙂',
  noMoreMoments: "That's every moment about it in the family record so far 🙂 Share a photo with a few words to add one.",
  adminOnly: 'Only a group admin can do that 🙂',
  // the menu that Telegram shows when someone types "/"; an admin sees only the admin list, so it repeats /memory
  commands: {
    group: [{ command: 'memory', description: 'Share a family memory in the group now' }],
    admins: [
      { command: 'memory', description: 'Share a family memory in the group now' },
      // v2: an ephemeral command, so only the presenter sees it
      { command: 'fastforward', description: 'Move the family clock, for example /fastforward 7 or /fastforward 08:05', is_ephemeral: true },
    ],
    private: [
      { command: 'start', description: 'Choose what I send you' },
      { command: 'stop', description: 'Stop everything I send you' },
    ],
  },
  buttons: {
    start: 'Start',
    // the buttons of a private memory: a label says what a tap does, and the most useful button comes first
    tellMeMore: 'Tell me more',
    replyToFamily: 'Reply to the family',
    notNow: 'Later, please',
    dontShowThese: "Don't show me these again",
    askCall: (name: string) => `Yes, ask ${name}`,
    share: 'Yes, share it',
    // v2, section 4.13: the reminder offer buttons
    remindAt: (time: string) => `Yes, at ${time}`,
    anotherTime: 'Pick another time',
    noThanks: 'No, thanks',
    stopReminders: 'Stop offering reminders',
    remindMe: 'Yes, remind me',
    // v2, sections 4.6, 4.11, and 4.12
    chooseForMe: 'Choose what I send you',
    choices: {
      moments: 'Family moments now and then',
      reminders: 'Reminders when I need them',
      shares: 'Offers to send my moments to the family',
      voice: 'Talk to me by voice',
      call: 'Call me on the phone',
    } as Record<ChoiceName, string>,
    done: 'Done',
    sharePhone: 'Share my phone number',
    sendIt: 'Yes, send it',
    stopOffering: 'Stop offering to share',
    anotherMoment: 'Send me a moment',
    whatDidIMiss: 'What did I miss?',
    mySettings: 'My settings',
    callMe: 'Call me',
    showMemory: 'Show us a memory',
    tellMember: (name: string) => `Tell ${name}`,
  },
};
