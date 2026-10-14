import { describe, expect, it } from 'vitest';
import {
  commonQuestionHint,
  DRILL_COMMON,
  DRILL_COMMON_QUESTIONS,
  DRILL_PERSONAS,
  getPersona,
  objectionQueue,
  randomPersona,
} from '../src/drill-personas.js';
import { buildPurposeProfile, PURPOSE_TYPES, TYPE_DISCOVERY_LAYERS } from '../src/purpose-types.js';
import { RULES } from '../src/rules.js';
import { countChars } from '../src/utils.js';

const TIERS = PURPOSE_TYPES.map((t) => t.key);

function customerSegs(p) {
  const texts = [p.greet, ...Object.values(p.layers), ...Object.values(p.tierLayers), ...Object.values(p.facts)];
  return texts.map((text, i) => ({ spk: 'C', text, start: i * 5, end: i * 5 + 4, chars: countChars(text) }));
}

describe('drill personas', () => {
  it('covers every purpose tier exactly once and all fit outcomes', () => {
    expect(DRILL_PERSONAS.map((p) => p.tier).sort()).toEqual([...TIERS].sort());
    expect(new Set(DRILL_PERSONAS.map((p) => p.fit))).toEqual(new Set(['A', 'B', 'C']));
    expect(new Set(DRILL_PERSONAS.map((p) => p.key)).size).toBe(DRILL_PERSONAS.length);
  });

  it.each(DRILL_PERSONAS.map((p) => [p.key, p]))('%s has a complete script', (_key, p) => {
    for (const field of ['name', 'brief', 'greet', 'noConnect', 'deflect', 'tooEarly', 'pitchReply', 'whyFit', 'accept', 'notYet', 'fitReason']) {
      expect(typeof p[field], field).toBe('string');
      expect(p[field].length, field).toBeGreaterThan(1);
    }
    for (let n = 1; n <= 5; n++) {
      expect(p.layers[n], `layers[${n}]`).toBeTruthy();
      expect(p.tierLayers[n], `tierLayers[${n}]`).toBeTruthy();
    }
    expect(Object.keys(p.facts).sort()).toEqual(['background', 'budget', 'time']);
    expect(p.objections.length).toBeGreaterThanOrEqual(4);
    expect(TYPE_DISCOVERY_LAYERS[p.tier]).toHaveLength(5);
  });

  it.each(DRILL_PERSONAS.map((p) => [p.key, p]))('%s: each general-layer answer is detectable by the analysis rules', (_key, p) => {
    RULES.layers.forEach((L) => {
      expect((L.customerRe || L.re).test(p.layers[L.n]), `${p.key} L${L.n}: ${p.layers[L.n]}`).toBe(true);
    });
  });

  it.each(DRILL_PERSONAS.map((p) => [p.key, p]))('%s: the analysis engine identifies the hidden tier as dominant', (_key, p) => {
    const profile = buildPurposeProfile(customerSegs(p));
    expect(profile.dominant?.key, `${p.key} dominant=${profile.dominant?.key}`).toBe(p.tier);
  });

  it('brief never leaks the hidden tier label', () => {
    DRILL_PERSONAS.forEach((p) => {
      TIERS.forEach((t) => {
        const label = PURPOSE_TYPES.find((x) => x.key === t).label;
        expect(p.brief.includes(label)).toBe(false);
      });
    });
  });

  it('lookup helpers', () => {
    expect(getPersona('lin')?.tier).toBe('enjoy');
    expect(getPersona('nope')).toBeNull();
    expect(randomPersona(() => 0).key).toBe(DRILL_PERSONAS[0].key);
    expect(randomPersona(() => 0.999).key).toBe(DRILL_PERSONAS[DRILL_PERSONAS.length - 1].key);
    expect(DRILL_COMMON.pressure.length).toBeGreaterThan(1);
  });
});

describe('drill common questions', () => {
  it('includes the everyday prospect questions, each with a coaching hint', () => {
    expect(DRILL_COMMON_QUESTIONS.map((q) => q.text)).toEqual([
      '阿你們主要在做什麼的？',
      '跟其他AI課程有什麼不一樣？',
      '那你們的優勢是什麼？',
      '我聽不太懂你講的，可以試聽課程嗎？',
    ]);
    DRILL_COMMON_QUESTIONS.forEach((q) => {
      expect(commonQuestionHint(q.text)).toBe(q.hint);
      expect(q.hint).toMatch(/class="q"/);
    });
    expect(commonQuestionHint('欸你先跟我講，費用大概多少？')).toBe('');
  });

  it.each(DRILL_PERSONAS.map((p) => [p.key, p]))('%s: alternates own objections with common questions', (_key, p) => {
    const queue = objectionQueue(p);
    expect(queue).toHaveLength(p.objections.length + DRILL_COMMON_QUESTIONS.length);
    expect(queue[0]).toBe(p.objections[0]);
    expect(queue[1]).toBe(DRILL_COMMON_QUESTIONS[0].text);
    expect(queue[2]).toBe(p.objections[1]);
    expect(queue[3]).toBe(DRILL_COMMON_QUESTIONS[1].text);
    expect(new Set(queue)).toEqual(new Set([...p.objections, ...DRILL_COMMON_QUESTIONS.map((q) => q.text)]));
  });

  it('copes with a persona without its own objections', () => {
    expect(objectionQueue({ objections: [] })).toEqual(DRILL_COMMON_QUESTIONS.map((q) => q.text));
  });
});
