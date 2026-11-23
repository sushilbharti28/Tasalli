import { describe, expect, it } from 'vitest';
import { WebhookSignatureError } from '../src/providers/fake-telephony.js';
import { SayUrls, TwilioProvider, decodeSay, twilioSignature } from '../src/providers/twilio.js';
import { twilioEnv } from '../src/providers/twilio-factory.js';
import { SID, gatherDigits, gatherSpeech, gatherTimeout, status } from './fixtures/twilio.js';

const BASE = 'https://abc.trycloudflare.com';
const TOKEN = 'test-auth-token';
const say = new SayUrls();
const mk = (f?: typeof fetch) => new TwilioProvider({ accountSid: 'ACtest', authToken: TOKEN, publicBaseUrl: BASE, fetch: f });

function signed(kind: 'status' | 'input', params: Record<string, string>, query = 'c=call-1&n=abc') {
  const url = `${BASE}/webhooks/twilio/${kind}?${query}`;
  return { headers: { 'x-twilio-signature': twilioSignature(TOKEN, url, params), 'x-tasalli-url': url }, params };
}

describe('Twilio signature', () => {
  it('is HMAC-SHA1 of url + sorted params, base64', () => {
    // Expected value computed independently with Python hmac (same algorithm Twilio documents).
    const sig = twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
      CallSid: 'CA1234567890ABCDE', Caller: '+14158675310', Digits: '1234', From: '+14158675310', To: '+18005551212',
    });
    expect(sig).toBe('GvWf1cFY/Q7PnoempGyD5oXAezc=');
  });
  it('rejects tampered, missing and wrong-token signatures', () => {
    const p = mk();
    const { headers, params } = signed('input', gatherDigits('1'));
    expect(() => p.parseWebhook(headers, { ...params, Digits: '9' })).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook({ 'x-tasalli-url': headers['x-tasalli-url'] }, params)).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook({ ...headers, 'x-twilio-signature': twilioSignature('other', headers['x-tasalli-url'], params) }, params)).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook({ ...headers, 'x-tasalli-url': headers['x-tasalli-url'].replace('call-1', 'call-2') }, params)).toThrow(WebhookSignatureError);
  });
});

describe('Twilio parseWebhook', () => {
  const p = mk();
  const parse = (kind: 'status' | 'input', params: Record<string, string>) => { const s = signed(kind, params); return p.parseWebhook(s.headers, s.params); };

  it('maps status callbacks', () => {
    const cases: Array<[string, string]> = [['ringing', 'ringing'], ['in-progress', 'answered'], ['completed', 'completed'], ['busy', 'busy'], ['no-answer', 'no_answer'], ['failed', 'failed']];
    for (const [t, ours] of cases) {
      const ev = parse('status', status(t));
      expect(ev).toMatchObject({ type: 'status', status: ours, callId: 'call-1', providerCallId: SID });
    }
  });
  it('status event id is stable for a retried callback', () => {
    expect(parse('status', status('completed')).eventId).toBe(parse('status', status('completed')).eventId);
  });
  it('digits -> key', () => {
    expect(parse('input', gatherDigits('1'))).toMatchObject({ type: 'input', kind: 'key', value: '1', eventId: `${SID}:in:abc` });
  });
  it('speech -> transcript with confidence', () => {
    expect(parse('input', gatherSpeech('nahi li', '0.81'))).toMatchObject({ kind: 'speech', transcript: 'nahi li', confidence: 0.81 });
  });
  it('empty gather (redirect after timeout) -> speech event with no transcript', () => {
    const ev = parse('input', gatherTimeout());
    expect(ev).toMatchObject({ kind: 'speech' });
    expect((ev as { transcript?: string }).transcript).toBeUndefined();
  });
  it('rejects a payload without CallSid or callId', () => {
    const { CallSid: _c, ...rest } = gatherDigits('1');
    expect(() => parse('input', rest as Record<string, string>)).toThrow();
  });
});

describe('Twilio TwiML', () => {
  const p = mk();
  it('listening step: Say inside Gather (dtmf + speech, hi-IN) then Redirect', async () => {
    const url = await say.urlFor('Namaste <ji> & "dawai"', 'hi');
    const { contentType, body } = p.renderNextAction({ action: 'play', step: { audioUrl: url, listen: { keys: ['1', '9'], speech: true, timeoutSeconds: 8 } } }, { callId: 'call-1' });
    expect(contentType).toBe('text/xml');
    expect(body).toContain('<Gather input="dtmf speech" language="hi-IN" speechTimeout="1" hints="le li,le liya,le lee,leli,lelee,lily,लिली,');
    expect(body).toContain('<Say voice="Google.hi-IN-Chirp3-HD-Aoede" language="hi-IN"><prosody rate="90%">Namaste &lt;ji&gt; &amp; &quot;dawai&quot;</prosody></Say>');
    expect(body).toMatch(/action="https:\/\/abc\.trycloudflare\.com\/webhooks\/twilio\/input\?c=call-1&amp;n=[0-9a-f]{16}"/);
    expect(body).toContain('<Redirect method="POST">');
  });
  it('keypad-only step has no speech input', async () => {
    const { body } = p.renderNextAction({ action: 'play', step: { audioUrl: await say.urlFor('x', 'hi'), listen: { keys: ['1'], speech: false, timeoutSeconds: 8 } } }, { callId: 'c' });
    expect(body).toContain('input="dtmf"');
    expect(body).not.toContain('speech');
  });
  it('hangup with and without a final message', async () => {
    expect(p.renderNextAction({ action: 'hangup' }).body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    expect(p.renderNextAction({ action: 'hangup', finalAudioUrl: await say.urlFor('Dhanyavaad', 'hi') }).body).toContain('<Say voice="Google.hi-IN-Chirp3-HD-Aoede" language="hi-IN"><prosody rate="90%">Dhanyavaad</prosody></Say><Hangup/>');
  });
  it('Devanagari text survives the round trip', async () => {
    expect(decodeSay(await say.urlFor('नमस्ते जी', 'hi')).text).toBe('नमस्ते जी');
  });
});

describe('Twilio placeCall', () => {
  it('posts to the Calls API with basic auth, TwiML and status callbacks', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ sid: SID }), { status: 201 }); }) as unknown as typeof fetch;
    const res = await mk(f).placeCall({
      callId: 'call-1', to: '+919876543210', callerId: '+15005550006', language: 'hi', purpose: 'consent',
      firstStep: { audioUrl: await say.urlFor('Namaste', 'hi'), listen: { keys: ['1', '9'], speech: true, timeoutSeconds: 8 } },
      statusWebhookUrl: 'ignored', inputWebhookUrl: 'ignored',
    });
    expect(res.providerCallId).toBe(SID);
    expect(seen!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Calls.json');
    const h = seen!.init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Basic ${Buffer.from(`ACtest:${TOKEN}`).toString('base64')}`);
    const form = new URLSearchParams(seen!.init.body as string);
    expect(form.get('To')).toBe('+919876543210');
    expect(form.get('From')).toBe('+15005550006');
    expect(form.get('Twiml')).toContain('<Gather');
    expect(form.get('StatusCallback')).toBe(`${BASE}/webhooks/twilio/status?c=call-1`);
    expect(form.getAll('StatusCallbackEvent')).toEqual(['ringing', 'answered', 'completed']);
  });
  it('throws a useful error (no secrets) when Twilio refuses, e.g. unverified trial number', async () => {
    const f = (async () => new Response(JSON.stringify({ code: 21219, message: 'The number is unverified.' }), { status: 400 })) as unknown as typeof fetch;
    await expect(mk(f).placeCall({ callId: 'c', to: '+919876543210', callerId: '+1', language: 'hi', purpose: 'consent',
      firstStep: { audioUrl: await say.urlFor('x', 'hi') }, statusWebhookUrl: '', inputWebhookUrl: '' })).rejects.toThrow(/21219.*unverified/);
  });
});

describe('Twilio env', () => {
  it('names every missing variable, never values', () => {
    expect(() => twilioEnv({ TWILIO_ACCOUNT_SID: 'AC1' })).toThrow('TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_BASE_URL');
  });

  it('v1.6: the acknowledgement is its own <Say> with no pause; speech timeout and model come from config', async () => {
    const { SAY_SPLIT } = await import('../src/scripts/builder.js');
    const { speechTimeoutFrom, speechModelFrom } = await import('../src/providers/twilio-factory.js');
    const p = new TwilioProvider({ accountSid: 'AC1', authToken: 't', publicBaseUrl: 'https://x.example', speechTimeout: '2', speechModel: 'googlev2_telephony_short' });
    const url = await new SayUrls().urlFor(`Theek hai.${SAY_SPLIT}Aapki doosri dawai.`, 'hi');
    const { body } = p.renderNextAction({ action: 'play', step: { audioUrl: url, listen: { keys: ['1'], speech: true, timeoutSeconds: 6 } } }, { callId: 'c1' });
    expect(body).toMatch(/Theek hai<\/prosody><\/Say><Say [^>]*><prosody rate="90%">Aapki doosri dawai<\/prosody><\/Say>/);
    expect(body).not.toContain('<Pause');
    expect(body).toContain('speechTimeout="2" speechModel="googlev2_telephony_short"');
    expect([speechTimeoutFrom(undefined), speechTimeoutFrom('auto'), speechTimeoutFrom('3'), speechTimeoutFrom('99'), speechTimeoutFrom('x"')]).toEqual(['1', 'auto', '3', '1', '1']);
    expect([speechModelFrom(undefined), speechModelFrom('googlev2_telephony_short'), speechModelFrom('a" b')]).toEqual([undefined, 'googlev2_telephony_short', undefined]);
  });

  it('safety (v1.6): the choices and the medicine are said outside the Gather; listening starts at the question', async () => {
    const { LONG_PAUSE, SAY_SPLIT } = await import('../src/scripts/builder.js');
    const p = new TwilioProvider({ accountSid: 'AC1', authToken: 't', publicBaseUrl: 'https://x.example' });
    const text = `Theek hai.${SAY_SPLIT}Har dawai lene ke baad, haan boliye. Aapki pehli dawai, ek goli Telma ki hai.${LONG_PAUSE}Dawai lene ke baad, haan boliye, ya ek dabaiye.`;
    const url = await new SayUrls().urlFor(text, 'hi');
    const { body } = p.renderNextAction({ action: 'play', step: { audioUrl: url, listen: { keys: ['1'], speech: true, timeoutSeconds: 6 } } }, { callId: 'c1' });
    const gather = body.indexOf('<Gather');
    expect(body.indexOf('Theek hai')).toBeLessThan(gather);
    expect(body.indexOf('Har dawai lene ke baad')).toBeLessThan(gather);
    expect(body.indexOf('Telma')).toBeLessThan(gather);
    expect(body.indexOf('ya ek dabaiye')).toBeGreaterThan(gather);
    expect(body.indexOf('ya ek dabaiye')).toBeLessThan(body.indexOf('</Gather>'));
    expect(body).not.toContain('\u2016');
    // A prompt with no mark (a plain question, e.g. the re-ask) is listened to whole.
    const q = p.renderNextAction({ action: 'play', step: { audioUrl: await new SayUrls().urlFor('Maaf kijiye, samajh nahi aaya.', 'hi'), listen: { keys: ['1'], speech: true, timeoutSeconds: 6 } } }, { callId: 'c1' }).body;
    expect(q.indexOf('<Gather')).toBeLessThan(q.indexOf('Maaf kijiye'));
  });
});
