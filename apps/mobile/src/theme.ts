/**
 * Design tokens. Every text/background pair used here meets WCAG AA (4.5:1) for body text.
 * Ratios checked in src/__tests__/theme.test.ts.
 */
export const colors = {
  bg: '#FBF7F2', // warm off-white
  surface: '#FFFFFF',
  primary: '#0F6E64', // deep teal
  primaryPressed: '#0B5850',
  onPrimary: '#FFFFFF',
  primarySoft: '#E2F0EE',
  ink: '#1F2A2E',
  inkMuted: '#4F5B60',
  border: '#D9D2C8',
  focus: '#0F6E64',
  danger: '#A32020',
  dangerSoft: '#FBE4E2',
  // Dose statuses: always paired with an icon and a word, never colour alone.
  upcoming: '#4B5559',
  upcomingSoft: '#ECEAE6',
  calling: '#7A4F00',
  callingSoft: '#FDF0D5',
  confirmed: '#1B6B3A',
  confirmedSoft: '#E3F3E8',
  missed: '#A32020',
  missedSoft: '#FBE4E2',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Minimum touch target (dp). Android guidance is 48; project floor is 44. */
export const touch = 48;
export const font = { small: 14, body: 16, large: 18, title: 22, hero: 28 } as const;
