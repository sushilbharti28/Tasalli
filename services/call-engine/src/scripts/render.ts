/**
 * Template rendering. Family-entered values are swapped in AFTER punctuation cleanup,
 * so cleanup (dropping the commas around empty fields) can never alter what the family typed.
 */
const OPEN = '';
const CLOSE = '';

export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]!);
}

export function render(template: string, vars: Record<string, string | number | null | undefined>): string {
  const values: string[] = [];
  let s = template.replace(/\{([a-z0-9_]+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === null || v === undefined || String(v).trim() === '') return '';
    values.push(String(v).trim());
    return `${OPEN}${values.length - 1}${CLOSE}`;
  });
  s = cleanup(s);
  return s.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_m, i: string) => values[Number(i)]!);
}

export function cleanup(text: string): string {
  let s = text.replace(/[ \t\r\n]+/g, ' ');
  for (let i = 0; i < 10; i++) {
    const before = s;
    s = s
      .replace(/\s+([,.:;!?])/g, '$1')
      .replace(/([,:;])\s*([,.:;!?])/g, '$2')
      .replace(/\.\s*\./g, '.')
      .replace(/^\s*[,.:;]\s*/, '')
      .replace(/\s{2,}/g, ' ');
    if (s === before) break;
  }
  return s.trim().replace(/[,:;]$/, '').trim();
}

export function joinSentences(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(' ');
}
