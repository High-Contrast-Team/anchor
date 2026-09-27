export type Media = { id: string; mimeType?: string };

export type Button = { label: string; data?: string; url?: string; contact?: boolean }; // v2 contact: a private reply-keyboard button that shares the member's phone number

export type Incoming = {
  familyId?: string; // set for group events; the router resolves private events
  chat: 'group' | 'private';
  chatId: string;
  messageId: string;
  sender: { id: string; name: string };
  at: number; // real time in ms
  text?: string; // text or caption
  photo?: Media; // the largest size
  video?: Media;
  thumbnail?: Media; // the preview frame of the video, for the classification
  voice?: Media;
  albumId?: string; // Telegram media_group_id: photos of one album share it
  forwarded?: boolean;
  forwardedFrom?: string; // the account id of the forward origin; unset when Telegram hides the account
  unsupported?: boolean; // sticker, GIF, video note, document, poll, service message
  replyTo?: string;
  replyToSender?: { id: string; name: string }; // the sender of the replied-to message
  migratedTo?: string; // the new chat id when the group became a supergroup
  button?: string; // the data of a pressed button
  joined?: boolean; // Anchor joined this group
  ephemeral?: boolean; // v2: an ephemeral command, or a tap on an ephemeral message; messageId holds the ephemeral message id
  contact?: { phone: string; userId?: string }; // v2: a shared contact; userId is set when the contact is a Telegram user
};

export type Outgoing = {
  text?: string; // the caption when photo or voice is set
  photo?: Media; // set at most one of photo, video, voice, album, and contact
  video?: Media;
  voice?: Media | { wav: Buffer };
  album?: Array<{ photo: Media } | { video: Media }>; // the caption goes on the first item; no buttons
  contact?: { phone: string; name: string }; // v2: a contact card
  mention?: Person; // mentions the first occurrence of the name in the text
  buttons?: Button[];
  replyTo?: string;
  onlyFor?: string; // v2: the user id of the only member who sees this group message (an ephemeral message); no replyTo
};

export class Blocked extends Error {} // send throws Blocked when the person blocked Anchor

export interface Transport {
  send(chatId: string, message: Outgoing): Promise<{ messageId: string; messageIds?: string[]; voice?: Media }>; // messageIds: every message of an album
  edit(chatId: string, messageId: string, change: { text?: string; buttons?: Button[]; onlyFor?: string }): Promise<void>; // v2: text replaces the text of a text message; buttons alone replace the buttons of any message
  remove(chatId: string, messageId: string, onlyFor?: string): Promise<void>; // v2
  react(chatId: string, messageId: string, emoji: string, big?: boolean): Promise<void>;
  download(media: Media): Promise<{ data: Buffer; mimeType: string }>;
  isAdmin(chatId: string, userId: string): Promise<boolean>;
  isMember(chatId: string, userId: string): Promise<boolean>; // the person is in the group now
  startLink(payload: string): string;
}

export type Person = { id: string; name: string };

export type Story = {
  id: string;
  by: Person;
  at: number; // demo-clock ms
  text: string; // the typed text or the transcript
  voice?: Media;
  messageIds: string[]; // group messages that carry the story
};

export type Moment = {
  id: string;
  by: Person;
  messageIds: string[]; // the group messages of the bundle
  savedAt: number; // demo-clock ms
  text: string; // the sender's own words, verbatim, or the title when wordless
  wordless?: boolean; // the sharer sent no words, so text holds the model's title
  photo?: Media;
  video?: Media; // a return shows the video when the moment has one
  voice?: Media;
  salience: number; // 1 to 5
  sensitive: boolean; // Anchor never brings the moment back
  people: string[];
  eventDate?: string; // YYYY-MM-DD
  title: string;
  tags?: string[]; // section 4.16: up to 5 names, pets, places, events, or activities, such as ["Lucy", "dog"]
  description?: string; // Anchor's own sentence about the picture, such as "The photo shows a girl at a school gate."; only the voice says it
  stories: Story[];
  lookbacks: string[]; // '7', '30', '365', 'anniversary-2027'
  memoryPostIds: string[];
  returns: Record<string, { count: number }>; // private returns per member id
  echo?: string; // the id of the older moment that this moment echoes
  echoPostIds?: string[]; // the messages of the then-and-now post
};

// a private memory of 1 to 5 moments; the name stays from the single-moment invitation of v1
export type Invitation = {
  id: string; // 8 characters, in the button data
  momentId: string; // the lead moment: the target of a story and of a family reply
  momentIds: string[]; // every moment of the memory, oldest first
  story?: { text: string; voice?: Media };
  shareAsked: boolean;
  helped: boolean; // the gentle help went out once
  said?: boolean; // the one-tap reply went to the group
  askedCall?: boolean; // the call request went to the group
};

export type Choices = { moments: boolean; reminders: boolean; shares: boolean; voice: boolean; call: boolean }; // v2, section 4.11

export type Member = Person & {
  started: boolean;
  talk?: Array<{ from: 'member' | 'anchor'; text: string }>; // the latest turns of the private chat with Anchor
  choices: Choices; // v2
  nudged?: boolean; // v2: the one join nudge went out
  phone?: string; // v2: E.164, from the one-tap contact share
  seenAt?: number; // v2: demo-clock ms, the newest savedAt that Anchor sent in private
  lastCallDay?: number; // v2: the demo-clock day index of the last daily call
  lastInvitationDay?: number;
  invitation?: Invitation;
  hidden?: string[]; // the moment ids that the member asked never to see again; the family still sees them
};

export type Offer = { // v2, sections 4.12 and 4.13
  id: string; // 8 characters, in the button data
  kind: 'share' | 'reminder';
  to: string; // the member id; the offer is an ephemeral message for this member
  messageId: string; // the ephemeral message id
  at: number; // demo-clock ms of the send
  ref: string; // the moment id of a share offer, or the reminder id of a reminder offer
};

export type Reminder = { // v2, section 4.13
  id: string; // 8 characters, in the button data and the start payload
  to: string; // the member id who gets the reminder
  from: Person; // the sender of the source message
  text: string; // the sender's words, verbatim
  sourceId: string; // the group message that gets the ✍ reaction
  time: string; // HH:MM, the suggestion, then the time that the member picked
  due?: number; // demo-clock ms, set with status 'set'
  status: 'offered' | 'waiting' | 'set' | 'sent'; // waiting: the member picked a time and has not tapped Start
  sentAt?: number; // demo-clock ms of the delivery
  birthday?: string; // the name of the person, for a birthday reminder
};

export type Birthday = { name: string; date: string; from: Person }; // date: MM-DD, from a group message that mentions it

export type ChatLine = { id: string; by: string; text: string; at: number }; // a group message; at in demo-clock ms

export type Family = {
  id: string; // the group chat id on the transport
  chatId: string; // the group chat id on the transport
  members: Member[]; // v2: renamed from storytellers
  moments: Moment[];
  offers: Offer[]; // v2
  reminders: Reminder[]; // v2
  birthdays?: Birthday[];
  chat?: ChatLine[]; // the latest group messages, the context of a private chat with Anchor
  lastShown?: string[]; // the moment ids of the latest group memory, which "more memories" leaves out
  lastMemoryDay?: number;
  spokenFor?: Record<string, string>; // the group message id of each line that Anchor posted for a member, and the member id
  counters: Record<string, number>;
};

export type State = { clockStart: number; clockOffset: number; families: Family[] }; // clockOffset in ms, set by /fastforward

export type Window = { from: number; to: number }; // demo-clock ms

export interface Store {
  readonly state: State;
  family(id: string): Family | undefined;
  addFamily(id: string, chatId: string): Family;
  familyOfMember(userId: string): Family | undefined; // v2: renamed from familyOfStoryteller
  joinMember(family: Family, person: Person): Member; // v2: adds a member with the default choices when the person is new
  save(): void;
}

export type Context = {
  now(): number; // demo-clock ms
  store: Store;
  transport(familyId: string): Transport;
  restartWindow?(): void; // v2: the next tick window starts at now, so no slot inside a clock jump fires
};

export interface Feature {
  name: string;
  handle?(event: Incoming, family: Family | undefined, ctx: Context): Promise<boolean>;
  tick?(family: Family, window: Window, ctx: Context): Promise<void>;
}
