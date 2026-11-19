import { Injectable } from '@nestjs/common';

export const SCRIPT_PREVIEWER = Symbol('SCRIPT_PREVIEWER');

export interface PreviewInput {
  personName: string;
  language: string;
  spokenName: string;
  amountText: string;
  food: 'before' | 'after' | 'with' | 'any';
  extraInstruction: string | null;
  disambiguator: { numberLabel: number | null; sayPrintedName: boolean; stripName: string };
}

/**
 * Builds what the reminder call will say. The real builder (6 languages, audio) belongs
 * to call-engine/content; the API calls it through this interface.
 */
export interface ScriptPreviewer {
  preview(input: PreviewInput): Promise<{ text: string; audioUrl: string }>;
}

const FOOD: Record<PreviewInput['food'], string> = {
  before: 'before food',
  after: 'after food',
  with: 'with food',
  any: '',
};

/** Fake: English text only, family's words repeated verbatim (safety rule 1), no audio. */
@Injectable()
export class FakeScriptPreviewer implements ScriptPreviewer {
  async preview(i: PreviewInput) {
    const dis = i.disambiguator.numberLabel !== null
      ? `, number ${i.disambiguator.numberLabel}`
      : i.disambiguator.sayPrintedName
        ? `, the strip that says ${i.disambiguator.stripName.toUpperCase().split('').filter((c) => c.trim()).join('-')}`
        : '';
    const parts = [`${i.personName} ji, time for ${i.spokenName}${dis}: ${i.amountText}`];
    if (FOOD[i.food]) parts.push(FOOD[i.food]);
    let text = parts.join(', ') + '.';
    if (i.extraInstruction) text += ` ${i.extraInstruction}`;
    text += ' Press 1 when you have taken it.';
    return { text, audioUrl: '' };
  }
}
