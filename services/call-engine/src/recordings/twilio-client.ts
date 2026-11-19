import type { RecordingClient } from './types.js';

/** Twilio Recordings API. Basic auth with the account SID and auth token; never sent anywhere but api.twilio.com. */
export class TwilioRecordingClient implements RecordingClient {
  private readonly f: typeof fetch;
  constructor(private readonly accountSid: string, private readonly authToken: string, f?: typeof fetch) {
    this.f = f ?? fetch;
  }
  private get auth() { return { authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}` }; }

  async download(recordingUrl: string) {
    const u = new URL(recordingUrl);
    // The URL arrives in a signed webhook, but credentials only ever go to Twilio's API host.
    if (u.protocol !== 'https:' || u.hostname !== 'api.twilio.com') throw new Error('recording URL is not on api.twilio.com');
    const res = await this.f(`${u.origin}${u.pathname.replace(/\.(mp3|wav|json)$/, '')}.mp3`, { headers: this.auth });
    if (!res.ok) throw new Error(`Twilio recording download failed: ${res.status}`);
    const len = res.headers.get('content-length');
    return { data: Buffer.from(await res.arrayBuffer()), expectedSize: len !== null && /^\d+$/.test(len) ? Number(len) : null };
  }

  async remove(recordingSid: string): Promise<void> {
    if (!/^RE[0-9A-Za-z]+$/.test(recordingSid)) throw new Error('bad recording sid');
    const res = await this.f(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Recordings/${recordingSid}.json`,
      { method: 'DELETE', headers: this.auth });
    if (res.status === 404) return; // already deleted
    if (!res.ok) throw new Error(`Twilio recording delete failed: ${res.status}`);
  }
}
