# Demo runbook: Anchor v2 live in a family group

The 6-minute presentation is one story: the problem with the website on the screen, a day in Sofia's family with Anchor, and the close back on the website. The live part shows Anchor v2: two family members post, the family clock moves to the next morning, and Sofia gets a private memory of the week. Sofia answers with one tap, and Anchor asks Eleni to call her.

The demo runs against the live bot `@anchor_family_bot` on Cloud Run (`DEPLOY.md`). Each `/fastforward 1` sends the memory again to every started member, so the team can rehearse on the live bot. Every line and every staged message is in English.

## Cast

Five teammates present, and four of them speak.

| Role | Who | Part |
| --- | --- | --- |
| Narrator | Teammate 1 | Tells the problem, and links the beats. |
| Eleni, the daughter | Teammate 2 | Phone 1, the family group. Posts the first photo, and speaks in character. |
| Sofia, the grandmother | Teammate 3 | Phone 2, her private chat with Anchor. Speaks in character. |
| Closer | Teammate 4 | Closes the story, and takes the Q&A. |
| Operator, also Alexandros | Teammate 5, a group admin | Posts the second photo as Alexandros from phone 3, and sends `/fastforward 1` from phone 3. Phone 3 stays off the screen. Shows the website during the problem and the close, shows the phones side by side during the story, keeps the stopwatch, and plays the recording if two beats fail. Silent. |

Anchor takes every name from Telegram. Set the first name of each demo account to its role name before the demo, for example "Eleni", "Sofia", and "Alexandros".

## Before the demo

Check the bot and the group:

1. Make sure that the live bot runs revision `anchor-bot-00028` or later. Revision `00028` adds `/fastforward now`, which sets the family clock back to the real time. Revision `00026` sends each started member a private memory of the week at each 11:00 slot and on each `/fastforward 1`. Revision `00014` connects Sofia to Eleni's phone at the end of the call. Revision `00015` says what a photo shows in the voice note and the call, for a photo captured after the deploy. Revision `00016` adds the scam shield. Revision `00017` asks a member for the phone number when the member taps "Call me" and has no number saved. Revision `00018` answers "Call me" with "You're up to date" when no new family moment is left to talk about, and labels the moment button "Send me a moment". Revision `00019` answers a question in private from the family record and the group chat, offers a reminder for a birthday that the group mentions, answers "memories of the dog" and "remind me about my pills", and shows the choices for any private message that says "settings". Revision `00020` answers "more memories of Lucy?" with moments that the group has not just seen, answers "Show me Lucy", and lets "A memory of Lucy" pass an open invitation. Revision `00021` serves the family record and its photos to the website at `/family`, and data export and deletion at `/my-data`, after a sign-in with Telegram. Revision `00022` posts a memory for a general request, such as "Give me a memory", without "Anchor,", and reads "@anchor_family_bot , ..." as "Anchor,". Revision `00023` reads a voice note as the text of its transcript, so a spoken request, such as "What did I miss?", gets the answer of the typed request. Revision `00024` rings the writer of a bare "Call me" in the group, says "Ask me anything about the family." after the share question of every call, and answers from the family record. With no new moment left, "Call me" now rings for questions, instead of "You're up to date". Revision `00025` answers a question in words and then shows the photo of the moment that the answer comes from, and code checks every number, name, and quote of the answer against the family record. It answers "Anchor, when did Maria start school?" in words, lets an album caption quote a family story, and says more about each photo, in at most 30 words, for a photo captured after the deploy. Revision `00007` takes the new first name of a renamed account, so Anchor calls the elder "Sofia". Revision `00008` reads the reminder and then a family moment in one call. The technical runbook names the current revision.
2. Use the group of the demo. A person is a member in one family only, so a new group sends Sofia's private replies to the old family.
3. Make sure that Anchor is an admin in the group. Anchor sends an ephemeral message only as an admin. Promote Anchor at least one day before, because a move to a supergroup posts `intro` a second time.
4. Make Alexandros a group admin, and turn "Remain anonymous" off for him. Anchor ignores commands from an anonymous admin.

Set the choices of each account. Each member sends "settings" to Anchor in private, taps the choices, and taps "Done":

1. Sofia: "Family moments now and then" and "Talk to me by voice" on, and "Call me on the phone" off. The calls tick rings a member with the call choice at the same 11:00 slot as the memory.
2. Every tester: "Call me on the phone" off, for the same reason.
3. Eleni: "Family moments now and then" and "Offers to send my moments to the family" off. Otherwise, her phone gets a private memory and a share offer on stage too.
4. A member who started before PR 77 keeps "Family moments" off. Turn "Family moments" on for each tester who wants the memory.

Reset and prepare, before the demo and before each rehearsal:

1. Remove the moments of the rehearsals. Reply "Anchor, forget this" to each rehearsal photo. The memory takes the 5 newest moments of the past 7 days, and the call question names the member who shared the most of them.
2. Put the staged photo of a child's first day at school on Eleni's phone. Its caption is "Maria's first day of school! She wore her new red backpack."
3. Put the staged beach photo on Alexandros's phone. Its caption is "Sunday lunch at the beach with the whole family!"
4. Keep a screen recording of the best rehearsal ready. Play the recording if the live bot fails.
5. Open the website https://anchor-open26.vercel.app in a browser tab on the Operator's laptop, next to the phones. The screen shows its landing page when the presentation starts.

Caution: a staged text must name no future action with a time, or a reminder offer appears on stage. A reminder that is still due fires inside the next jump, before the memory. The jump of a rehearsal fires every due reminder, so rehearse after the last reminder test.

## The script

Each beat names the action, the spoken lines, and what the audience sees. The times include about 5 seconds of model latency per beat, so a speaker talks while Anchor works. The run ends at about 3:30. UNVERIFIED: time the run in the first rehearsal.

### The problem (0:00, Narrator)

The screen shows the landing page of the website. On "Meet Anchor", the Operator switches the screen to both phones.

> This is Sofia. She lives on her own, and she likes it that way. By the time she finds her glasses, the photos of her granddaughter are buried under forty new messages in the family chat. She doesn't want to be a burden, so she stops asking. Slowly, she drops out of her own family's story.
>
> Living independently also means staying part of your family's life. Meet Anchor.

### The story, live

| Beat | Time | Who | Action | Spoken lines | The audience sees |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:40 | Eleni, then Alexandros | Eleni posts the school photo with its caption. Then Alexandros posts the beach photo with its caption. | Eleni, before: "Maria's first day of school. Mum has to see this." | Anchor reacts with ❤ on each photo within seconds. The group sees no other message. |
| 2 | 1:05 | Alexandros | On phone 3, pick `/fastforward` in the command menu of the group, add "1", and send it on the Narrator's line. | Narrator: "The next morning." | Nothing new on the screen. Only phone 3 shows "⏩ It's now … on the family clock." |
| 3 | 1:15 | Anchor | Sends Sofia the album, then one voice note. | Sofia: "Oh, Maria's first day!" | The album caption reads "This week in the family 💛" and a caption that names Eleni and Alexandros. The voice note says the caption, then "What does it remind you of?", with the buttons "Tell me more", "Reply to the family", and "Later, please". |
| 4 | 1:45 | Sofia | Tap "Reply to the family". | None | The buttons of the same message change at once to "❤️ Sending my love", "😊 That made me smile", and "💛 I miss you all". |
| 5 | 1:55 | Sofia, then Eleni | Tap "💛 I miss you all". | Eleni, after the group line: "Mum saw them!" | The buttons collapse to "✅ Sent to the family". The group gets "Sofia: «I miss you all 💛»" as a reply to Eleni's photo. |
| 6 | 2:10 | Anchor | Sends Sofia one voice note. | None | "Shall I ask Eleni to call you?", with the buttons "Yes, ask Eleni" and "No, thanks". |
| 7 | 2:20 | Sofia, then Eleni | Tap "Yes, ask Eleni". | Eleni: "Calling you now, Mum." Narrator: "And when nobody is free, Anchor can ring Sofia and have this same talk by voice." | The buttons collapse to "✅ Asked Eleni to call you". The group gets "Eleni, Sofia would love a call from you 💛", with a mention of Eleni. |

### The close (2:40, Closer)

Both screens stay on the group until the Operator switches the screen to the website.

> Sofia saw her family's week without searching the chat. She answered with one tap, and Eleni called her. Nobody acted for her.
>
> Anchor says it is not a person. It shares nothing without a yes, and it keeps a painful memory without ever bringing it back on its own. And when a message pretends to be Eleni and asks for money, Sofia forwards it to Anchor, and Anchor tells her to call Eleni first.
>
> Anchor runs live today, in the group chat the family already uses. And you can try it yourself, on our website: anchor-open26.vercel.app.
>
> Anchor keeps the family's story, so nobody drops out of it.

On "our website", the Operator switches the screen from the phones to the landing page of the website. The screen stays on the website for the Q&A.

The call question names the member who shared the most moments of the memory. On a tie, it names the member who shared first. For this reason, Eleni posts first, and each poster posts one photo only. A voice note from Alexandros counts as a second moment when it comes after the ❤ of his photo.

The script does not show "Tell me more". A tap on "Tell me more" sends one voice note that names each moment, its date, and what the picture shows, then plays the voice notes of the sharers. That message has the buttons "Reply to the family" and "Don't show me these again". "Don't show me these again" hides the moments from Sofia only, and the family still sees them. "Later, please" collapses the buttons to "✅ Another day, then". The Closer can answer about each in the Q&A.

## Questions to expect

"Isn't a bot in the family chat annoying?"

- Anchor answers a message that names Anchor, with "Anchor," or with "@anchor_family_bot". A message without "Anchor," gets an answer in two cases only. The first case is a general request, such as "Give me a memory" or "any memories?". The second case is a request for memories or photos of someone or something already in the family record, when the model agrees that it is a request. When Anchor is unsure, it says nothing. It never answers "I didn't understand" to family talk.
- A reply between two people never reaches Anchor.
- In a replay on the live family record on 2026-09-26, 10 of 12 memory requests got the album, and 0 of 14 ordinary messages got an answer, among them photo questions to a person, such as "Can you send me the photos from yesterday?".
- Every offer has an easy no, an unanswered offer fades, and "stop" turns Anchor off for one person.

"Can Anchor make things up?"

- Anchor answers a question only from the family record and the group chat. The answer names who shared the moment and quotes their words, and the photo of that moment follows, so the family sees where the answer came from.
- Code checks every number, name, and quote in the answer against the moments it cites. An answer that fails the check becomes "Here is what the family record says 💛" and the photo.
- In a replay with a record like the demo record, 10 of 10 questions that the record answers got a checked answer with its photo. 9 of 10 questions that the record does not answer, such as "Which school does Maria go to?", got "The family record doesn't say", and the check stopped the tenth, an invented age.

"Is Sofia safe from scams?"

- Sofia forwards a suspicious message to Anchor. When the message uses a family name to ask for money, a code, or bank details, and it did not come from that person's Telegram account, Anchor tells her to call the person on the number she knows, and offers to tell them. Anchor never says that a message is certainly safe or certainly a scam.
- Anchor reads only what Sofia forwards to it.
- In a test on the real model, 6 of 6 scam runs got the warning, and 0 of 6 ordinary requests did, among them "Mum, can you send me the photos from yesterday?".

"What about accessibility?"

- Sofia never needs to read or type: she taps large buttons and answers by voice. A spoken request, such as "What did I miss?", gets the answer of the typed request.
- The voice notes and the call say what each photo shows, without names or judgments, for a member who cannot see the photo well.

## If a beat fails

- No ❤ in beat 1 after 10 seconds: Eleni continues with beat 2. `/fastforward` saves every open post before the clock moves, so the photo still joins the memory.
- The group sees "/fastforward 1" or "⏩ It's now …" in beat 2: the command went out as a normal message, not from the command menu. Continue with beat 3.
- No memory on Sofia's phone in beat 3 after 15 seconds: Sofia sends "Send me a moment" to Anchor in private. A memory of one moment arrives with the same buttons, and the story continues with beat 4.
- The call question names Alexandros instead of Eleni: Sofia taps "Yes, ask Alexandros", and Alexandros says Eleni's line. Before the next run, remove the extra moments of the week.
- The website does not load in the close: the Operator keeps the phones on the screen, and the Closer says the line with the address.
- Two beats fail: the Operator stops the live demo and plays the screen recording. The speakers say their lines over the recording.

To read what the bot did, run this command after the demo:

```bash
gcloud run services logs read anchor-bot --project=a11y-hack26ath-267 --region=europe-west1 --limit=50
```

## Rehearse twice

Caution: `/fastforward` moves the family clock of the whole bot until `/fastforward now`. A jump of whole days keeps the hour of the 11:00 and 18:00 slots. From the 7th jump on, each jump reaches an 18:00 slot with a moment that is 7 days old, and a group memory posts. `/fastforward now` sets the family clock back to the real time, and the count of jumps starts again. Before the demo, send `/fastforward now` after the last rehearsal.

1. Before each rehearsal, do the steps of "Reset and prepare".
2. Run the full script on the live bot with a stopwatch, and write down the time of each beat.
3. Run `/fastforward 1` a second time without a new post. Make sure that Sofia gets the memory again, and that the group gets no new post.
4. If the run takes more than 3:30, shorten the spoken lines first.
5. After the last rehearsal, Alexandros sends `/fastforward now` from the command menu. Then do the steps of "Reset and prepare" again.
