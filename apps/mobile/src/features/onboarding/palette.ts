/**
 * Onboarding palette from docs/prototypes/onboarding-v6.html: deep teal ground, warm yellow highlight.
 * Used by the story and the setup questions. Text pairs pass WCAG AA on `ground`.
 */
export const onboarding = {
  ground: '#0F3B35',
  ink: '#FFFFFF',
  soft: '#CFE6E0',
  hi: '#FFD166',
  onHi: '#1F1A05',
  card: '#FFFFFF',
  cardInk: '#17302B',
  cardMuted: '#4E6862',
  handset: '#23302D',
  key: '#3A4A46',
  display: '#B9E4D3',
  displayInk: '#12302A',
  /** Borders and quiet surfaces on the ground. */
  line: 'rgba(255,255,255,0.22)',
  surface: 'rgba(255,255,255,0.07)',
  picked: 'rgba(255,209,102,0.14)',
  avatar: '#1E5A51',
  warn: '#FFB054',
} as const;
