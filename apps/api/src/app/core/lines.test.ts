import { expect, test } from 'vitest';
import { lines } from './lines';
import type { Moment } from './types';

const sofia = { id: '1', name: 'Sofia' };
const nikos = { id: '2', name: 'Nikos' };

function moment(fields: Partial<Moment> = {}): Moment {
  return {
    id: 'm1',
    by: sofia,
    messageIds: [],
    savedAt: 0,
    text: 'Maria on her first day',
    salience: 3,
    sensitive: false,
    people: [],
    title: "Maria's first day at school",
    stories: [],
    lookbacks: [],
    memoryPostIds: [],
    returns: {},
    ...fields,
  };
}

const wordless = (fields: Partial<Moment> = {}) => moment({ text: "Maria's first day at school", wordless: true, ...fields });

test('sharedBy quotes the sharer, and names a wordless photo, video, or voice note with its title and no quote marks', () => {
  expect(lines.sharedBy(moment())).toBe('Sofia shared: «Maria on her first day»');
  expect(lines.sharedBy(wordless({ photo: { id: 'p1' } }))).toBe("Sofia shared a photo: Maria's first day at school");
  expect(lines.sharedBy(wordless({ photo: { id: 'p1' }, video: { id: 'v1' } }))).toBe("Sofia shared a video: Maria's first day at school");
  expect(lines.sharedBy(wordless({ voice: { id: 'a1' } }))).toBe("Sofia shared a voice note: Maria's first day at school");
  expect(lines.sharedBy(wordless({ photo: { id: 'p1' }, voice: { id: 'a1' } }))).toBe("Sofia shared a photo: Maria's first day at school");
});

test('a moment with words keeps the quoting lines byte for byte', () => {
  expect(lines.memoryCaption('One week ago', moment())).toBe(
    'One week ago 💛\nSofia shared: «Maria on her first day»\nReply with a story or a voice note to add it to the family record.',
  );
  expect(lines.echoCaption(moment({ by: nikos, text: 'My first day, 1958' }), moment())).toBe(
    'Then and now 💛\nNikos shared: «My first day, 1958»\nSofia shared: «Maria on her first day»',
  );
});

test('a private memory names each moment with its date, and only the voice says what the picture shows', () => {
  const described = moment({
    photo: { id: 'p1' },
    savedAt: new Date(2026, 8, 25, 12).getTime(),
    description: 'The photo shows a girl with a red backpack at a school gate.',
  });
  const other = moment({ by: nikos, text: 'Sunday lunch', savedAt: new Date(2026, 8, 20, 12).getTime() });
  expect(lines.aboutMoments([described, other])).toBe(
    'Sofia shared: «Maria on her first day» · 25 September 2026\nNikos shared: «Sunday lunch» · 20 September 2026',
  );
  expect(lines.aboutMoments([described, other], true)).toBe(
    'Sofia shared: «Maria on her first day» · 25 September 2026\nThe photo shows a girl with a red backpack at a school gate.\n' +
      'Nikos shared: «Sunday lunch» · 20 September 2026',
  );
  expect(lines.aboutMoments([moment({ text: 'a'.repeat(300) })])).toContain(`«${'a'.repeat(119)}…»`);
});

test('the private memory lines read as the spike writes them', () => {
  expect(lines.weekMemory('Sofia and Nikos shared a school day.')).toBe('This week in the family 💛\nSofia and Nikos shared a school day.');
  expect(lines.weekMemory('Sofia shared the beach.', lines.thenLabel)).toBe('Then and now in the family 💛\nSofia shared the beach.');
  expect(lines.weekShared([moment(), moment({ by: nikos }), moment()])).toBe('Sofia and Nikos shared 3 moments.');
  expect(lines.remindYou).toBe('What does it remind you of?');
  expect(lines.familyReplies.map(([emoji, words]) => `${emoji} ${words}`)).toEqual(['❤️ Sending my love', '😊 That made me smile', '💛 I miss you all']);
  expect(lines.familyReply('Sofia', lines.familyReplies[2])).toBe('Sofia: «I miss you all 💛»');
  expect(lines.askCall('Eleni')).toBe('Shall I ask Eleni to call you?');
  expect(lines.answers.map(([emoji, words]) => `${emoji} ${words}`)).toEqual(['❤️ Love you too', "😊 Can't wait", '👍 Okay']);
  expect(lines.familySaid('Eleni', 'Calling you now, Mum ❤️')).toBe('Eleni: «Calling you now, Mum ❤️»');
  expect(lines.familySaid('Eleni', 'a'.repeat(400))).toBe(`Eleni: «${'a'.repeat(299)}…»`);
  expect(lines.sentTo('Eleni')).toBe('✅ Sent to Eleni');
  expect(lines.done).toEqual({
    sent: '✅ Sent to the family',
    later: '✅ Another day, then',
    hidden: "✅ I won't show you these again",
    askedCall: expect.any(Function),
  });
  expect(lines.done.askedCall('Eleni')).toBe('✅ Asked Eleni to call you');
  expect([lines.buttons.tellMeMore, lines.buttons.replyToFamily, lines.buttons.notNow]).toEqual(['Tell me more', 'Reply to the family', 'Later, please']);
  expect([lines.buttons.askCall('Eleni'), lines.buttons.dontShowThese]).toEqual(['Yes, ask Eleni', "Don't show me these again"]);
});

test('a wordless photo goes through memoryCaption, aboutMoments, and echoCaption with the photo phrase and no quote mark', () => {
  const photo = wordless({ photo: { id: 'p1' } });
  const outputs = [
    lines.memoryCaption('One week ago', photo),
    lines.aboutMoments([photo]),
    lines.echoCaption(photo, wordless({ by: nikos, video: { id: 'v1' } })),
  ];
  for (const output of outputs) {
    expect(output).toContain("Sofia shared a photo: Maria's first day at school");
    expect(output).not.toMatch(/[«»]/);
  }
});

test('sharedBy and memoryCaption clip a long quote to 600 characters that end with …', () => {
  const long = moment({ text: 'a'.repeat(2000) });
  const clip = `«${'a'.repeat(599)}…»`;
  expect(lines.sharedBy(long)).toContain(clip);
  expect(lines.memoryCaption('One week ago', long)).toContain(clip);
  expect(lines.sharedBy(moment({ text: 'b'.repeat(600) }))).toContain(`«${'b'.repeat(600)}»`);
});

test('storyAdded clips its quote to 600 characters', () => {
  expect(lines.storyAdded('Nikos', 'Sofia', 'a'.repeat(2000))).toContain(`«${'a'.repeat(599)}…»`);
});

test('echoCaption clips each quote to 450 characters, so the caption stays under 1024 with both quotes closed', () => {
  const echo = lines.echoCaption(moment({ by: nikos, text: 'a'.repeat(2000) }), moment({ text: 'b'.repeat(2000) }));
  expect(echo).toContain(`«${'a'.repeat(449)}…»`);
  expect(echo).toContain(`«${'b'.repeat(449)}…»`);
  expect(echo.length).toBeLessThan(1024);
  expect(echo.endsWith('…»')).toBe(true);
});

test('the clip keeps whole emoji and stays inside 600 UTF-16 units', () => {
  expect(lines.sharedBy(moment({ text: `${'a'.repeat(597)}😀😀😀` }))).toContain(`«${'a'.repeat(597)}😀…»`);
  expect(lines.sharedBy(moment({ text: `${'a'.repeat(597)}👨‍👩‍👧 end` }))).toContain(`«${'a'.repeat(597)}…»`);
  expect(lines.sharedBy(moment({ text: `${'a'.repeat(596)}🇬🇷🇬🇷` }))).toContain(`«${'a'.repeat(596)}…»`);
  expect(lines.memoryCaption('One week ago', moment({ text: '😀'.repeat(700) }))).toContain(`«${'😀'.repeat(299)}…»`);
});

test('the welcome, stop, and just-ask lines read as the design writes them', () => {
  expect(lines.welcome('Nikos')).toBe(
    "Hello Nikos 🙂 I'm Anchor. I'm not a person: I keep your family's photos and stories. " +
      'I can send you family moments now and then, remind you of things, and talk to you by voice. ' +
      "Seeing moments again helps them stay with us. Tap what you'd like. You can change it at any time: just say \"settings\".",
  );
  expect(lines.stopped).toBe('Of course. I won\'t send you anything more. If you\'d like moments again, say "settings".');
  expect(lines.tellDirectly("Maria's first day at school", '25 September 2026', 'Sofia')).toBe(
    "This is Maria's first day at school, from 25 September 2026. Sofia shared it 💛",
  );
});

test('intro points to the choices button instead of /private', () => {
  expect(lines.intro).toContain('Tap the button to choose what I send you in private. ');
  expect(lines.intro).not.toContain('/private');
});

test('the v2 step 5 lines read as the design writes them', () => {
  expect(lines.nudge('Nikos')).toBe('Nikos, I can send you family moments, reminders, and voice notes in private. Tap to choose 🙂');
  expect(lines.choice(true, 'Talk to me by voice')).toBe('✅ Talk to me by voice');
  expect(lines.choice(false, 'Talk to me by voice')).toBe('⬜ Talk to me by voice');
  expect(lines.choicesSaved(['family moments', 'reminders', 'voice notes'])).toBe(
    'All set 💛 You get: family moments, reminders, and voice notes. Say "settings" to change this.',
  );
  expect(lines.choicesSaved([])).toBe('All set. I won\'t send you anything for now. Say "settings" to change this.');
  expect(lines.shareOffer(['Nikos'])).toBe('Shall I send this to Nikos now?');
  expect(lines.shareSent(['Nikos', 'Maria'])).toBe('Sent to Nikos and Maria 💛');
  expect(lines.missed(3)).toBe('The family shared 3 moments since we last talked 💛');
  expect(lines.buttons.choices.shares).toBe('Offers to send my moments to the family');
});

test('the v2 reminder and call lines read as the design writes them', () => {
  expect(lines.reminderOffer('You', 'take my pills')).toBe('⏰ You wrote: «take my pills»\nShall I remind you?');
  expect(lines.reminderOffer('Sofia', 'a'.repeat(2000))).toContain(`«${'a'.repeat(599)}…»`);
  expect(lines.reminderSet('08:00')).toBe("Done ✍ I'll remind you at 08:00 in our private chat.");
  expect(lines.reminderStart('08:00')).toBe("Tap Start, and I'll remind you at 08:00 in our private chat 🙂");
  expect(lines.reminderConfirmed('08:00')).toBe("Done ✍ I'll remind you here at 08:00.");
  expect(lines.reminder('Sofia', 'take my pills')).toBe('⏰ Your reminder. Sofia wrote: «take my pills»');
  expect(lines.fastforwardUsage).toBe('Send /fastforward and a number of days, a time, or "now", for example /fastforward 7, /fastforward 08:05, or /fastforward now.');
  expect(lines.call.opening('Nikos')).toBe("Hello Nikos, this is Anchor, the family's record keeper. I'm not a person.");
  expect(lines.call.askShare).toBe('Shall I share what you told me with the family?');
  expect(lines.call.reachPerson('Sofia')).toBe("Shall I tell Sofia you'd love a call?");
  expect(lines.call.connect('Sofia')).toBe('Shall I connect you to Sofia now?');
  expect(lines.call.connecting('Nikos', 'Sofia')).toBe("Thank you, Nikos. I'm connecting you to Sofia now. Goodbye 💛");
  expect(lines.call.goodbye('Nikos')).toBe('Thank you, Nikos. Goodbye 💛');
  expect(lines.wouldLoveCall('Nikos', 'Sofia')).toBe('Sofia, Nikos would love a call from you 💛');
  expect(lines.buttons.remindAt('08:00')).toBe('Yes, at 08:00');
  expect(lines.buttons.anotherTime).toBe('Pick another time');
  expect(lines.buttons.noThanks).toBe('No, thanks');
  expect(lines.buttons.stopOffering).toBe('Stop offering to share');
  expect(lines.buttons.stopReminders).toBe('Stop offering reminders');
});
