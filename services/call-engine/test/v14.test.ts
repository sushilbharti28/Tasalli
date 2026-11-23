import { describe, expect, it } from 'vitest';
import { softLimitSeconds, hardLimitSeconds } from '../src/flows/limits.js';
import { SayUrls, TwilioProvider, toSsml } from '../src/providers/twilio.js';
import { BUILTIN_PHRASES } from '../src/speech/phrases.js';
import { matchIntent } from '../src/speech/intent.js';
import { DEFAULT_SCRIPTS_DIR, ScriptLibrary } from '../src/scripts/loader.js';
import { PARENT, world, type World } from './helpers.js';

const hindi = new ScriptLibrary(DEFAULT_SCRIPTS_DIR).get('hi').phrases; // built-in lists + packages/scripts/engine/hi.yaml
const builtin = BUILTIN_PHRASES.hi;
const books = { builtin, 'hi.yaml pack': hindi };

describe('v1.4 recognition: confirm variants (the transcript "लिली।" was "le li")', () => {
  const confirms = ['लिली', 'लिली।', 'लीली', 'लेली', 'ले ली', 'ले लिया', 'लेलिया', 'ली ली', 'lily', 'Lily!', 'leli', 'le li', 'le lee', 'lelee',
    'le liya', 'ho gaya', 'हो गया', 'हाँ', 'हां', 'हा', 'haan', 'han', '  Le   Li  ', 'हाँ, ले ली।', 'haan. le li.'];
  for (const [name, book] of Object.entries(books)) {
    for (const said of confirms) {
      it(`${name}: "${said}" confirms`, () => {
        expect(matchIntent(said, book, 'reminder').intent).toBe('confirm');
      });
    }
  }
  const nevers = ['नहीं ली', 'नहीं ली।', 'nahi li', 'Nahi li!', 'nahi lily', 'नहीं लिली', 'nahi leli', 'nahin le li', 'haan nahi', 'हाँ नहीं', 'लिली नहीं',
    'abhi nahi le li', 'nahi, ho gaya nahi', 'nahi lee', 'mat', 'ho gaya nahi'];
  for (const [name, book] of Object.entries(books)) {
    for (const said of nevers) {
      it(`${name}: "${said}" never confirms`, () => {
        expect(matchIntent(said, book, 'reminder').intent).not.toBe('confirm');
      });
    }
  }
  it('"nahi li" is a decline, "baad mein le li" a snooze, "khatam ho gaya" not a confirm', () => {
    expect(matchIntent('nahi li', hindi, 'reminder').intent).toBe('decline');
    expect(matchIntent('नहीं ली', hindi, 'reminder').intent).toBe('decline');
    expect(matchIntent('baad mein le li', hindi, 'reminder').intent).toBe('snooze');
    expect(matchIntent('dawai khatam ho gaya', hindi, 'reminder').intent).not.toBe('confirm');
  });
  it('low confidence and unknown words are never a confirmation', () => {
    expect(matchIntent('lily', builtin, 'reminder', 0.3).intent).toBe('unclear');
    expect(matchIntent('hmm achha', builtin, 'reminder').intent).toBe('unclear');
  });
});

describe('v1.4 prompt wording', () => {
  it('every medicine line (full and short, one or many) ends with the short question (v1.6: "haan" or 1; no "le li")', async () => {
    const w = world(undefined, { scripts: new ScriptLibrary(null) });
    w.med('BP wali', '09:00');
    w.med('Sugar wali', '09:05');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }] });
    await w.queue.add('schedule.replan', { personId: w.mom.id });
    await w.settle();
    await w.advance(1);
    const said = w.playedText(0);
    const prompt = 'Dawai lene ke baad, "haan" boliye, ya ek dabaiye.';
    expect(said[0]!.endsWith(prompt)).toBe(true);
    expect(said[1]!.endsWith(prompt)).toBe(true);
  });
  it('the Hindi script has the Devanagari question, and no prompt asks for "le li"', () => {
    const t = new ScriptLibrary(DEFAULT_SCRIPTS_DIR).get('hi').templates.reminder;
    expect(t.step_item_ask).toBe('दवाई लेने के बाद, "हाँ" बोलिए, या 1 दबाइए।');
    for (const k of ['step_item', 'step_item_one', 'step_item_short', 'step_item_short_one', 'step_intro', 'step_intro_one', 'step_unclear'] as const) {
      expect(t[k]).not.toMatch(/"ले ली"/);
    }
    expect(t.step_intro).toMatch(/"फिर से" बोलिए, या 0 दबाइए। अभी नहीं लेनी हो, तो "नहीं" बोलिए, या 2 दबाइए।$/);
  });
});

describe('v1.4 SSML pace', () => {
  const say = new SayUrls();
  const mk = (ssml?: boolean) => new TwilioProvider({ accountSid: 'ACtest', authToken: 't', publicBaseUrl: 'https://x.example', ssml });
  it('wraps in prosody 90%: 200 ms at a comma, 350 ms at a sentence end, 700 ms at the long pause before the question', () => {
    expect(toSsml('Aapki pehli dawai, 1 goli Telma ki hai. Iska patta laal hai। \u2016 Dawai lene ke baad, haan boliye।')).toBe(
      '<prosody rate="90%">Aapki pehli dawai<break time="200ms"/>1 goli Telma ki hai<break time="350ms"/>Iska patta laal hai'
      + '<break time="700ms"/>Dawai lene ke baad<break time="200ms"/>haan boliye</prosody>');
  });
  it('plain text (TWILIO_SSML=off) and TTS never say the long-pause mark', async () => {
    const { body } = mk(false).renderNextAction({ action: 'hangup', finalAudioUrl: await say.urlFor('Patta laal hai. \u2016 Haan boliye.', 'hi') });
    expect(body).toContain('>Patta laal hai. Haan boliye.</Say>');
  });
  it('escapes XML inside SSML, and no raw text can open a tag', () => {
    const s = toSsml('A <b>&</b> "x", y\'s. </prosody><break/>');
    expect(s).not.toMatch(/<b>|<\/b>/);
    expect(s).toContain('A &lt;b&gt;&amp;&lt;/b&gt; &quot;x&quot;');
    expect(s).toContain('y&apos;s');
    expect(s.match(/<prosody/g)).toHaveLength(1);
    expect(s.match(/<break/g)).toHaveLength(2); // only the two we put in; the typed <break/> is escaped text
    expect(s).toContain('&lt;/prosody&gt;&lt;break/&gt;');
  });
  it('renders inside <Say> in a Gather and in a hangup', async () => {
    const url = await say.urlFor('पहली दवाई: BP wali। 1 गोली, सफ़ेद गोली।', 'hi');
    const { body } = mk().renderNextAction({ action: 'play', step: { audioUrl: url, listen: { keys: ['1'], speech: true, timeoutSeconds: 8 } } }, { callId: 'c1' });
    expect(body).toContain('<Say voice="Google.hi-IN-Chirp3-HD-Aoede" language="hi-IN"><prosody rate="90%">पहली दवाई<break time="200ms"/>BP wali<break time="350ms"/>1 गोली<break time="200ms"/>सफ़ेद गोली</prosody></Say></Gather>');
    const bye = mk().renderNextAction({ action: 'hangup', finalAudioUrl: await say.urlFor('Koi baat nahi. Dhanyavaad.', 'hi') }).body;
    expect(bye).toContain('<prosody rate="90%">Koi baat nahi<break time="350ms"/>Dhanyavaad</prosody></Say><Hangup/>');
  });
  it('ssml:false (TWILIO_SSML=off) gives plain escaped text', async () => {
    const { body } = mk(false).renderNextAction({ action: 'hangup', finalAudioUrl: await say.urlFor('A & B. C', 'hi') });
    expect(body).toContain('>A &amp; B. C</Say>');
    expect(body).not.toContain('prosody');
  });
});

describe('v1.4 limits (pure)', () => {
  it('soft limit is 180 s up to 5 medicines, +40 s each above; hard is +30 s', () => {
    expect([1, 3, 5, 6, 8].map(softLimitSeconds)).toEqual([180, 180, 180, 220, 300]);
    expect([1, 6].map(hardLimitSeconds)).toEqual([210, 250]);
  });
});

const planned = async (w: World) => { await w.queue.add('schedule.replan', { personId: w.mom.id }); await w.settle(); };
const status = (w: World) => w.store.allDoses().filter((d) => d.dueAt.toISOString() < '2026-03-10T12:00:00Z').map((d) => d.status);

describe('v1.4 repeat limit: heard 3 times at most', () => {
  function two(scenario: Parameters<World['provider']['script']>[1]) {
    const w = world();
    w.med('BP wali', '09:00');
    w.med('Sugar wali', '09:05');
    w.provider.script(PARENT, scenario, { answer: 'answered', inputs: [{ key: '1' }] });
    return w;
  }
  it('third repeat request: "not recorded", moving on, "we will call again"; dose stays unconfirmed, call moves on', async () => {
    const w = two({ answer: 'answered', inputs: [{ key: '0' }, { say: 'phir se' }, { key: '0' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said).toHaveLength(5); // opening, repeat 1, repeat 2, "aage badhte hain" + medicine 2, closing line
    expect(said[1]).toMatch(/^Aapki Pehli dawai, ek goli BP wali ki hai\./);
    expect(said[2]).toBe(said[1]);
    expect(said[3]).toMatch(/^Maaf kijiye, kisi wajah se is dawai ka jawab darj nahi ho paaya\. Hum agli dawai par chalte hain\. Chinta mat kijiye, is dawai ke liye hum aapko phir phone karenge\. Aapki Doosri dawai, ek goli Sugar wali ki hai\./);
    expect(said[3]).not.toBe(said[1]);
    expect(said.filter((x) => x.includes('Pehli dawai, ek goli BP wali')).length).toBe(3); // heard 3 times in all
    expect(status(w)).toEqual(['calling', 'confirmed']);
    expect(w.store.allCalls()[0]!.result).toBe('none');
    await w.advance(11); // normal follow-up: the 10 minute retry asks only about BP wali
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(w.playedText(1).join(' ')).not.toMatch(/Sugar wali/);
    expect(w.playedText(1)[0]).toContain('BP wali');
  });
  it('same with a duplicate webhook for every input: nothing is counted twice', async () => {
    const w = two({ answer: 'answered', duplicateWebhooks: true, inputs: [{ key: '0' }, { key: '0' }, { key: '0' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(w.playedText(0).filter((x) => x.includes('Pehli dawai, ek goli BP wali')).length).toBe(3);
    expect(status(w)).toEqual(['calling', 'confirmed']);
    expect(w.provider.callsTo(PARENT)).toHaveLength(1);
  });
  it('repeat count starts again for the next medicine', async () => {
    const w = two({ answer: 'answered', inputs: [{ key: '0' }, { key: '0' }, { key: '1' }, { key: '0' }, { key: '0' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(status(w)).toEqual(['confirmed', 'confirmed']);
    expect(w.playedText(0).join(' ')).not.toMatch(/agli dawai par chalte hain/);
  });
  it('last medicine repeated a third time: moves on to the closing line, dose stays open', async () => {
    const w = world();
    w.med('BP wali', '09:00');
    w.provider.script(PARENT, { answer: 'answered', inputs: [{ key: '0' }, { key: '0' }, { key: '0' }] }, { answer: 'no_answer' });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[said.length - 1]).toBe('Maaf kijiye, kisi wajah se is dawai ka jawab darj nahi ho paaya. Chinta mat kijiye, is dawai ke liye hum thodi der mein phir phone karenge. Dhanyavaad, namaste.');
    expect(status(w)).toEqual(['calling']);
  });
  it('the repeat words are explained once at the start and again in the unclear re-ask; each medicine ends with the short question', async () => {
    const w = two({ answer: 'answered', inputs: [{ key: '0' }, { say: 'hmm' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[0]).toMatch(/Dawai ka rang-roop sunna ho, ya dobara sunna ho, to "phir se" boliye, ya zero dabaiye\./);
    expect(said[1]!.endsWith('Dawai lene ke baad, "haan" boliye, ya ek dabaiye.')).toBe(true);
    expect(said[2]).toMatch(/Dawai ka rang-roop sunna ho, ya dobara sunna ho, to "phir se" boliye, ya zero dabaiye\.$/);
  });
});

describe('v1.4 call time limit (fake clock)', () => {
  const TIME_UP = 'Samay poora ho gaya. Chinta mat kijiye, baaki dawai ke liye hum thodi der mein phir phone karenge. Dhanyavaad, namaste.';
  function meds(n: number, scenario: Parameters<World['provider']['script']>[1]) {
    const w = world();
    for (let i = 0; i < n; i++) w.med(`Dawai ${i + 1}`, `09:0${i}`);
    w.provider.script(PARENT, scenario, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    return w;
  }
  it('3 medicines, 100 s per step: ends politely before the third; the third follows the normal retry', async () => {
    const w = meds(3, { answer: 'answered', secondsPerStep: 100, inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said).toHaveLength(3); // opening, medicine 2, the time-up line (no medicine 3)
    expect(said[2]).toBe(`Theek hai. ${TIME_UP}`);
    expect(said.join(' ')).not.toContain('Dawai teen');
    expect(status(w)).toEqual(['confirmed', 'confirmed', 'calling']);
    expect(w.store.allCalls()[0]!.result).toBe('none');
    await w.advance(14); // (the helper's clock restarts at the minute: the call took 200 s, the retry is 10 minutes after it ended)
    expect(w.provider.callsTo(PARENT)).toHaveLength(2);
    expect(w.playedText(1).join(' ')).toContain('Dawai teen');
    expect(w.playedText(1).join(' ')).not.toContain('Dawai do');
    expect(status(w)).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });
  it('under the limit nothing is cut: 3 medicines at 50 s per step all confirm', async () => {
    const w = meds(3, { answer: 'answered', secondsPerStep: 50, inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(status(w)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(w.playedText(0).join(' ')).not.toContain('Samay poora');
  });
  it('exactly at the limit (180 s) the next step is not started', async () => {
    const w = meds(2, { answer: 'answered', secondsPerStep: 180, inputs: [{ key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(w.playedText(0)[1]).toBe(`Theek hai. ${TIME_UP}`);
    expect(status(w)).toEqual(['confirmed', 'calling']);
  });
  it('6 medicines: the limit is 220 s (not 180) and TimeLimit is 250', async () => {
    const w = meds(6, { answer: 'answered', secondsPerStep: 45, inputs: [{ key: '1' }, { key: '1' }, { key: '1' }, { key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    // inputs arrive at 45, 90, 135, 180, 225 s: the 5th (225 >= 220) is the first one over the limit, 180 would have cut the 4th.
    expect(status(w)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'calling']);
    expect(w.playedText(0).slice(-1)[0]).toBe(`Theek hai. ${TIME_UP}`);
    expect(w.provider.callsTo(PARENT)[0]!.request).toMatchObject({ timeLimitSeconds: 250 });
  });
  it('a medicine repeated until the limit: the re-ask is not started, call ends politely', async () => {
    const w = meds(2, { answer: 'answered', secondsPerStep: [10, 100, 100], inputs: [{ key: '0' }, { key: '0' }, { key: '0' }] });
    await planned(w);
    await w.advance(1);
    const said = w.playedText(0);
    expect(said[said.length - 1]).toBe(TIME_UP);
    expect(status(w)).toEqual(['calling', 'calling']);
    expect(w.store.allCalls()[0]!.result).toBe('none');
  });
  it('a "not taken" answer is recorded before the call ends; snooze rules still apply', async () => {
    const w = meds(2, { answer: 'answered', secondsPerStep: 200, inputs: [{ say: 'nahi li' }] });
    await planned(w);
    await w.advance(1);
    expect(w.playedText(0)[1]).toBe(`Koi baat nahi, thodi der mein phir yaad dilayenge. ${TIME_UP}`);
    expect(w.store.allCalls()[0]!.result).toBe('snoozed');
    expect(status(w)).toEqual(['calling', 'calling']);
  });
  it('TimeLimit (soft + 30 s) is sent on a reminder call and not on a consent call', async () => {
    const w = meds(3, { answer: 'answered', inputs: [{ key: '1' }, { key: '1' }, { key: '1' }] });
    await planned(w);
    await w.advance(1);
    expect(w.provider.callsTo(PARENT)[0]!.request).toMatchObject({ timeLimitSeconds: 210 });
    const c = world();
    const p = c.store.addPerson({ ownerUserId: c.user.id, phone: '+919811111111', nickname: 'Papa', consent: 'pending' });
    c.provider.script(p.phone, { answer: 'no_answer' });
    await c.queue.add('consent.call', { personId: p.id });
    await c.settle();
    expect(c.provider.callsTo(p.phone)[0]!.request).not.toHaveProperty('timeLimitSeconds');
  });
  it('Twilio call creation carries TimeLimit', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ sid: 'CAx' }), { status: 201 }); }) as unknown as typeof fetch;
    const p = new TwilioProvider({ accountSid: 'ACtest', authToken: 't', publicBaseUrl: 'https://x.example', fetch: f });
    const say = new SayUrls();
    await p.placeCall({ callId: 'c', to: '+919876543210', callerId: '+1', language: 'hi', purpose: 'reminder', timeLimitSeconds: 210,
      firstStep: { audioUrl: await say.urlFor('x', 'hi') }, statusWebhookUrl: '', inputWebhookUrl: '' } as never);
    expect(new URLSearchParams(body).get('TimeLimit')).toBe('210');
  });
});
