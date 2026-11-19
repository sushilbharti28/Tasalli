/** Payloads shaped like real Twilio callbacks (form fields), recorded from the Voice docs; no real calls. */
export const SID = 'CA0123456789abcdef0123456789abcdef';
export const status = (CallStatus: string, extra: Record<string, string> = {}) => ({
  AccountSid: 'ACtest', ApiVersion: '2010-04-01', CallSid: SID, CallStatus, Called: '+919876543210', Caller: '+15005550006',
  Direction: 'outbound-api', From: '+15005550006', To: '+919876543210', SequenceNumber: '1', ...extra,
});
export const gatherDigits = (Digits: string) => ({ ...status('in-progress'), Digits, FinalDigits: Digits });
export const gatherSpeech = (SpeechResult: string, Confidence = '0.92') => ({ ...status('in-progress'), SpeechResult, Confidence, Language: 'hi-IN' });
export const gatherTimeout = () => status('in-progress');
