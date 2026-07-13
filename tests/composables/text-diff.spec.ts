import { describe, expect, it } from 'vitest';
import { diffRows, diffWords, splitSegments, useTextDiff } from '~/composables/useTextDiff';

const byType = (ops: { t: string; v: string }[], t: string) =>
	ops.filter((o) => o.t === t).map((o) => o.v);

describe('diffWords', () => {
	it('marks every token eq for identical strings', () => {
		const ops = diffWords('the quick fox', 'the quick fox');
		expect(ops.every((o) => o.t === 'eq')).toBe(true);
		expect(byType(ops, 'eq').join('')).toBe('the quick fox');
		expect(byType(ops, 'del')).toEqual([]);
		expect(byType(ops, 'ins')).toEqual([]);
	});

	it('reports inserted words as ins ops', () => {
		const ops = diffWords('a c', 'a b c');
		expect(byType(ops, 'del')).toEqual([]);
		expect(byType(ops, 'ins').join('')).toContain('b');
	});

	it('reports deleted words as del ops', () => {
		const ops = diffWords('a b c', 'a c');
		expect(byType(ops, 'ins')).toEqual([]);
		expect(byType(ops, 'del').join('')).toContain('b');
	});

	it('reports a replacement as a del + ins around the common tokens', () => {
		const ops = diffWords('the quick fox', 'the slow fox');
		expect(byType(ops, 'del')).toContain('quick');
		expect(byType(ops, 'ins')).toContain('slow');
		const eq = byType(ops, 'eq');
		expect(eq).toContain('the');
		expect(eq).toContain('fox');
	});

	it('is all-ins from empty to text', () => {
		const ops = diffWords('', 'x y');
		expect(byType(ops, 'ins').join('')).toBe('x y');
	});

	it('is all-del from text to empty', () => {
		const ops = diffWords('x y', '');
		expect(byType(ops, 'del').join('')).toBe('x y');
	});

	it('treats two empty strings as a single eq of the empty token', () => {
		expect(diffWords('', '')).toEqual([{ t: 'eq', v: '' }]);
	});

	it('preserves whitespace tokens', () => {
		const ops = diffWords('a b', 'a b');
		expect(ops.map((o) => o.v)).toEqual(['a', ' ', 'b']);
	});
});

describe('splitSegments', () => {
	it('splits on sentence boundaries', () => {
		expect(splitSegments('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
	});

	it('splits on newlines and trims each segment', () => {
		expect(splitSegments('  Hello \n\n World.  ')).toEqual(['Hello', 'World.']);
	});

	it('drops empty/whitespace-only segments', () => {
		expect(splitSegments('\n\n   \n')).toEqual([]);
	});

	it('returns an empty array for empty input', () => {
		expect(splitSegments('')).toEqual([]);
	});
});

describe('diffRows', () => {
	it('emits eq rows for identical text', () => {
		expect(diffRows('A. B.', 'A. B.')).toEqual([
			{ type: 'eq', left: 'A.', right: 'A.' },
			{ type: 'eq', left: 'B.', right: 'B.' }
		]);
	});

	it('pairs a changed segment into one change row', () => {
		expect(diffRows('Hello there.', 'Hello world.')).toEqual([
			{ type: 'change', left: 'Hello there.', right: 'Hello world.' }
		]);
	});

	it('renders an added segment as left null / right value', () => {
		expect(diffRows('A.', 'A. B.')).toEqual([
			{ type: 'eq', left: 'A.', right: 'A.' },
			{ type: 'change', left: null, right: 'B.' }
		]);
	});

	it('renders a removed segment as left value / right null', () => {
		expect(diffRows('A. B.', 'A.')).toEqual([
			{ type: 'eq', left: 'A.', right: 'A.' },
			{ type: 'change', left: 'B.', right: null }
		]);
	});

	it('treats case + whitespace differences as equal (norm)', () => {
		const rows = diffRows('Hello   World.', 'hello world.');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.type).toBe('eq');
		expect(rows[0]!.left).toBe('Hello   World.');
	});

	it('aligns uneven del/ins blocks, padding the shorter side with null', () => {
		const rows = diffRows('A. B. C.', 'X. Y.');
		expect(rows).toHaveLength(3);
		expect(rows.every((r) => r.type === 'change')).toBe(true);
		expect(rows[2]).toEqual({ type: 'change', left: 'C.', right: null });
	});

	it('returns no rows for two empty strings', () => {
		expect(diffRows('', '')).toEqual([]);
	});
});

describe('useTextDiff', () => {
	it('exposes the three pure diff helpers', () => {
		const diff = useTextDiff();
		expect(typeof diff.diffWords).toBe('function');
		expect(typeof diff.diffRows).toBe('function');
		expect(typeof diff.splitSegments).toBe('function');
		expect(diff.splitSegments('One. Two.')).toEqual(['One.', 'Two.']);
	});
});
