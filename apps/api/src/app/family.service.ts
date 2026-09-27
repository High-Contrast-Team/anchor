import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { demoNow } from './core/clock';
import { createRouter } from './core/router';
import { openStore } from './core/store';
import type { Context, Feature, Window } from './core/types';
import { capture, forget } from './features/capture/capture';
import { calls } from './features/calls';
import { echoes } from './features/echoes';
import { fastforward } from './features/fastforward';
import { intents } from './features/intents';
import { intro } from './features/intro';
import { invitations, latestPhotos } from './features/invitations';
import { members } from './features/members';
import { memories } from './features/memories';
import { reminders } from './features/reminders/reminders';
import { scams } from './features/scams';
import { shares } from './features/shares';
import { talk } from './features/talk';
import { transcripts } from './features/transcripts';
import { TelegramTransport } from './transports/telegram';

// scams sits before members and invitations, so a forwarded "stop" or a forward during an open invitation reaches the scam check;
// transcripts sits first, so every feature reads a voice note as its transcript; talk sits next, so it logs every group message
export const FEATURES: Feature[] = [transcripts, talk, intro, fastforward, forget, reminders, scams, members, invitations, memories, intents, capture, latestPhotos, shares, echoes, calls];

// v2, section 4.8: restartWindow collapses the running window to empty at the tick that follows the call, never the in-flight one
export function nextWindow(from: number, to: number, restart: boolean): Window {
  return { from: restart ? to : from, to };
}

@Injectable()
export class FamilyService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FamilyService.name);
  private readonly stop = new AbortController();
  private timer?: NodeJS.Timeout;
  web?: { ctx: Context; botId: string; addLink: string }; // set once the bot polls; the website API reads the record through it

  onApplicationBootstrap() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    this.start(token).catch((error) => {
      if (!this.stop.signal.aborted) this.logger.error(`The family bot stopped: ${error}`);
    });
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
    this.stop.abort();
  }

  private async start(token: string) {
    const store = openStore(process.env.ANCHOR_STATE_FILE || 'tmp/anchor-state.json');
    const configured = Number(process.env.ANCHOR_DAY_SECONDS);
    const daySeconds = configured > 0 ? configured : 86400;
    const telegram = await TelegramTransport.connect(token, this.stop.signal);
    const now = () => demoNow(store.state, daySeconds);
    let restart = false;
    const ctx: Context = { now, store, transport: () => telegram, restartWindow: () => (restart = true) };
    const router = createRouter(FEATURES, ctx);
    this.web = { ctx, botId: token.split(':')[0], addLink: telegram.groupLink() };

    // ponytail: the first window starts at boot, so a slot that falls while the host is down is skipped; persist the last tick when that matters
    let from = now();
    let ticking = false;
    this.timer = setInterval(async () => {
      if (ticking) return;
      ticking = true;
      const to = now();
      const window = nextWindow(from, to, restart);
      restart = false;
      try {
        await router.tick(window);
      } catch (error) {
        this.logger.error(`The tick failed: ${error}`);
      } finally {
        from = to;
        ticking = false;
      }
    }, 2000);

    try {
      this.logger.log(`The family bot polls Telegram as @${telegram.username}, one demo day every ${daySeconds} s`);
      await telegram.poll((event) => router.route(event), this.stop.signal);
    } finally {
      clearInterval(this.timer);
    }
  }
}
