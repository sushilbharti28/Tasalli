import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { SpeechProvider } from '@tasalli/contracts';
import { WebSocketServer } from 'ws';
import type { Engine } from '../engine/engine.js';
import type { Logger } from '../log.js';
import type { Store } from '../store/store.js';
import type { ExotelProvider } from './exotel.js';
import { VoicebotSession } from './exotel-voicebot.js';

export const VOICEBOT_PATH = '/exotel/voicebot';

/**
 * Accept Exotel's Voicebot WebSocket on VOICEBOT_PATH. Configure the applet URL as
 *   wss://<public host>/exotel/voicebot?t=<EXOTEL_WEBHOOK_SECRET>
 * (or Basic auth with that secret as the password). Anything else is refused.
 */
export function attachExotelVoicebot(server: Server, o: { engine: Engine; provider: ExotelProvider; store: Store; speech: SpeechProvider; log: Logger; secret: string }): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const basic = /^Basic (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
    const fromBasic = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':').slice(1).join(':') : '';
    const given = url.searchParams.get('t') ?? fromBasic;
    if (url.pathname !== VOICEBOT_PATH || !same(given, o.secret)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return void socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      new VoicebotSession(ws as unknown as ConstructorParameters<typeof VoicebotSession>[0], {
        handleEvent: (ev) => o.engine.handleEvent(ev),
        findCall: (sid) => o.store.getCallByProviderCallId(sid),
        takeFirstStep: (sid) => o.provider.takeFirstStep(sid),
        speech: o.speech, log: o.log,
      });
    });
  });
  return wss;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return b.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
