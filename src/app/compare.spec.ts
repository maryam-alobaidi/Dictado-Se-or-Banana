import { OP, compare, norm, tok } from './compare';

describe('compare', () => {
  it('gives 10 to a perfect dictation', () => {
    const r = compare('El gato come pescado.', 'El gato come pescado.', false);
    expect(r.score).toBe(10);
    expect(r.errors).toBe(0);
    expect(r.wrong).toEqual([]);
  });

  it('counts a missing accent as half a mistake', () => {
    const r = compare('Mañana iré al mercado', 'Mañana ire al mercado', false);
    expect(r.items.map((x) => x.op)).toEqual([OP.OK, OP.ACCENT, OP.OK, OP.OK]);
    expect(r.errors).toBe(0.5);
    expect(r.score).toBe(8.8);
    expect(r.wrong).toEqual(['iré']);
  });

  it('marks wrong, missing and extra words', () => {
    const r = compare('el perro grande ladra', 'el pero ladra mucho', false);
    expect(r.items).toEqual([
      { op: OP.OK, expected: 'el' },
      { op: OP.WRONG, expected: 'perro', written: 'pero' },
      { op: OP.MISSING, expected: 'grande' },
      { op: OP.OK, expected: 'ladra' },
      { op: OP.EXTRA, written: 'mucho' },
    ]);
    expect(r.errors).toBe(3);
  });

  it('ignores punctuation unless asked to count it', () => {
    expect(compare('Hola, Ana.', 'Hola Ana', false).errors).toBe(0);
    expect(compare('Hola, Ana.', 'Hola Ana', true).errors).toBe(2);
  });

  it('remembers which words start a sentence', () => {
    expect([...compare('Hola. ¿Qué tal?', '', false).starts]).toEqual(['Hola', 'Qué']);
  });

  it('unifies apostrophes and the Catalan l·l', () => {
    expect(norm('l’hora')).toBe("l'hora");
    expect(norm('col.legi')).toBe('col·legi');
    expect(tok("L'àvia i la col·lecció", false)).toEqual(["L'àvia", 'i', 'la', 'col·lecció']);
  });
});
