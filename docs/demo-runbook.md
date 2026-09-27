# Demo runbook: Anchor v2 live in a family group

The 6-minute presentation is one story: the problem with the website on the screen, a day in Sofia's family with Anchor, and the close back on the website. The live part shows Anchor v2: Odisseas posts a photo in the family group, and Sofia gets a private memory of the latest family photos seconds later. Sofia answers with one tap, and Anchor asks Odisseas to call her.

The demo runs against the live bot `@anchor_family_bot` on Cloud Run (`DEPLOY.md`). Each new photo in the group sends the memory to every started member, the poster too, so the team can rehearse on the live bot without a clock jump. Every line and every staged message is in English.

## Cast

Five teammates present, and four of them speak.

| Role | Who | Part |
| --- | --- | --- |
| Narrator | Teammate 1 | Tells the problem, and links the beats. |
| Odisseas, the grandson | Teammate 2 | Phone 1, the family group. Posts the stage photo, replies to the call request, and speaks in character. |
| Sofia, the grandmother | Teammate 3 | Phone 2, her private chat with Anchor. Speaks in character. |
| Closer | Teammate 4 | Closes the story, and takes the Q&A. |
| Operator | Teammate 5 | Shows the website during the problem and the close, shows the phones side by side during the story, keeps the stopwatch, and plays the recording if two beats fail. Silent. |

Anchor takes every name from Telegram. Set the first name of each demo account to its role name before the demo, for example "Odisseas" and "Sofia".

## Before the demo

Check the bot and the group:

1. Make sure that the live bot runs revision `anchor-bot-00032-pd4` or later. Revision `00032` sends every started member the 5 latest photos of the family chat on each new photo, and revision `00034` sends them to the poster too. Revision `00031` tells "Tell me more" as a short story, and revision `00029` brings a family reply to Sofia's line back to her in private. The technical runbook names the current revision.
2. Use the group of the demo. A person is a member in one family only, so a new group sends Sofia's private replies to the old family.
3. Make sure that Anchor is an admin in the group. Anchor sends an ephemeral message only as an admin. Promote Anchor at least one day before, because a move to a supergroup posts `intro` a second time.
4. Turn "Remain anonymous" off for the admin who sends `/fastforward now` after a rehearsal that jumped. Anchor ignores commands from an anonymous admin.

Set the choices of each account. Each member sends "settings" to Anchor in private, taps the choices, and taps "Done":

1. Sofia: "Family moments now and then" and "Talk to me by voice" on, and "Call me on the phone" off. The calls tick rings a member with the call choice at the same 11:00 slot as the memory.
2. Every tester: "Call me on the phone" off, for the same reason.
3. Odisseas: "Offers to send my moments to the family" off, so no share offer shows on his phone. Keep his "Family moments now and then" off, so his phone gets no memory of his own photo on stage.
4. A member who started before PR 77 keeps "Family moments" off. Turn "Family moments" on for each tester who wants the memory.

Reset and prepare, before the demo and before each rehearsal:

1. Remove the photos of the rehearsals. Reply "Anchor, forget this" to each rehearsal photo, and keep the two staged photos of step 2. The memory holds the 5 latest photos of the family chat, and the call question names the member who shared the most of them.
2. Before the demo, post two staged photos in the group: first Eleni's beach photo with the caption "Sunday lunch at the beach with the whole family!", then one photo from Odisseas. Odisseas then shares the most photos of the latest 5, so the call question names him.
3. Put the staged photo of a child's first day at school on Odisseas's phone. Its caption is "Maria's first day of school! She wore her new red backpack."
4. Keep a screen recording of the best rehearsal ready. Play the recording if the live bot fails.
5. Open the website https://anchor-open26.vercel.app in a browser tab on the Operator's laptop, next to the phones. The screen shows its landing page when the presentation starts.

Caution: a staged text must name no future action with a time, or a reminder offer appears on stage.

## The script

Each beat names the action, the spoken lines, and what the audience sees. The times include about 5 seconds of model latency per beat, so a speaker talks while Anchor works. The run ends at about 3:20. UNVERIFIED: time the run in the first rehearsal.

### The problem (0:00, Narrator)

The screen shows the landing page of the website. On "Meet Anchor", the Operator switches the screen to both phones.

> This is Sofia. She lives on her own, and she likes it that way. By the time she finds her glasses, the photos of her granddaughter are buried under forty new messages in the family chat. She doesn't want to be a burden, so she stops asking. Slowly, she drops out of her own family's story.
>
> Living independently also means staying part of your family's life. Meet Anchor.

### The story, live

| Beat | Time | Who | Action | Spoken lines | The audience sees |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:40 | Odisseas | Post the school photo with its caption. | Narrator: "This is what the family already does every day. Odisseas shares a photo in the family chat. No special behaviour is required." | Anchor reacts with ❤ within seconds. The group sees no other message. |
| 2 | 1:00 | Anchor | Sends Sofia the album, then one voice note. | Narrator: "Seconds later, Anchor sends Sofia the latest photos from the family chat, with a short summary of what everyone shared, read aloud." | The album shows the latest photos, Odisseas's new photo last. Its caption reads "The latest from the family 💛" and a caption that names the sharers. The voice note says the caption, then "What does it remind you of?", with the buttons "Tell me more", "Reply to the family", "Later, please", and "Call me". |
| 3 | 1:20 | Sofia | Tap "Reply to the family", then "💛 I miss you all". | Narrator: "Sofia replies to the family with one tap, from a few ready-made answers." | The buttons change in place to the three replies, then collapse to "✅ Sent to the family". The group gets "Sofia: «I miss you all 💛»" as a reply to Odisseas's photo. |
| 4 | 1:40 | Anchor, then Sofia | Anchor sends one voice note. Sofia taps "Yes, ask Odisseas". | Narrator: "Anchor then asks if she wants Odisseas to call her." | "Shall I ask Odisseas to call you?", with "Yes, ask Odisseas" and "No, thanks". After the tap, the buttons collapse to "✅ Asked Odisseas to call you", and the group gets "Odisseas, Sofia would love a call from you 💛", with a mention of Odisseas. |
| 5 | 2:00 | Odisseas, then Sofia | Odisseas replies to "Odisseas, Sofia would love a call from you 💛" in the group with "Calling you now, Grandma ❤️". Sofia taps "❤️ Love you too". | Narrator: "His reply comes straight back to Sofia's private chat, and she answers with one more tap. She never had to open the busy group. And if nobody is free, she taps 'Call me', and Anchor rings her." | Sofia gets a voice note: "Odisseas: «Calling you now, Grandma ❤️»", with "❤️ Love you too", "😊 Can't wait", and "👍 Okay". After the tap, the buttons collapse to "✅ Sent to Odisseas", and the group gets "Sofia: «Love you too ❤️»" as a reply to Odisseas. |

### The close (2:30, Closer)

Both screens stay on the group until the Operator switches the screen to the website.

> Sofia saw her family's latest photos without searching the chat. She answered with one tap, and Odisseas called her. Nobody acted for her.
>
> Anchor says it is not a person. It shares nothing without a yes, and it keeps a painful memory without ever bringing it back on its own. And when a message pretends to be Eleni and asks for money, Sofia forwards it to Anchor, and Anchor tells her to call Eleni first.
>
> Anchor runs live today, in the group chat the family already uses. And you can try it yourself, on our website: anchor-open26.vercel.app.
>
> Anchor keeps the family's story, so nobody drops out of it.

On "our website", the Operator switches the screen from the phones to the landing page of the website. The screen stays on the website for the Q&A.

The call question names the member who shared the most photos of the memory. On a tie, it names the member who shared first. For this reason, Odisseas posts one staged photo before the demo, after Eleni's, and one photo on stage.

The script does not show "Tell me more". A tap on "Tell me more" sends one voice note that tells the moments as a short story, with what each photo shows, then plays the voice notes of the sharers. That message has the buttons "Reply to the family" and "Don't show me these again". "Don't show me these again" hides the moments from Sofia only, and the family still sees them. "Later, please" collapses the buttons to "✅ Another day, then". The Closer can answer about each in the Q&A.

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

- No ❤ in beat 1 after 10 seconds: the model is slow. Wait 10 more seconds, and the Narrator keeps talking.
- No memory on Sofia's phone in beat 2 after 15 seconds: Sofia sends "Send me a moment" to Anchor in private. A memory of one moment arrives with the same buttons, and the story continues with beat 3.
- The call question names Eleni instead of Odisseas: Sofia taps "Yes, ask Eleni", and Odisseas replies anyway. Before the next run, check the order of the staged photos in "Reset and prepare".
- The website does not load in the close: the Operator keeps the phones on the screen, and the Closer says the line with the address.
- Two beats fail: the Operator stops the live demo and plays the screen recording. The speakers say their lines over the recording.

To read what the bot did, run this command after the demo:

```bash
gcloud run services logs read anchor-bot --project=a11y-hack26ath-267 --region=europe-west1 --limit=50
```

## Rehearse twice

Caution: the stage flow needs no `/fastforward`. If a rehearsal moves the family clock, an admin sends `/fastforward now` after it, which sets the clock back to the real time.

1. Before each rehearsal, do the steps of "Reset and prepare".
2. Run the full script on the live bot with a stopwatch, and write down the time of each beat.
3. Post one more photo from another account. Make sure that Sofia and the poster get the memory again.
4. If the run takes more than 3:20, shorten the spoken lines first.
5. After the last rehearsal, do the steps of "Reset and prepare" again.
