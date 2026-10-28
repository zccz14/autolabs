import { describe, expect, it } from 'vitest';
import { assertPath, diffSnapshots, externalRef, labLabel, sha256Hex, treeSha } from '../src/labs';
import { mintProjectToken, parseProjectToken, tokenFingerprint } from '../src/tokens';

describe('lab numbering', () => {
  it('pads to four digits and never reuses zero/negative', () => {
    expect(labLabel(1)).toBe('lab-0001');
    expect(labLabel(82)).toBe('lab-0082');
    expect(labLabel(12345)).toBe('lab-12345');
    expect(() => labLabel(0)).toThrow();
    expect(() => labLabel(-3)).toThrow();
  });

  it('builds the idempotency key used for Cybion threads', () => {
    expect(externalRef('q-labs', 7)).toBe('autolabs:q-labs:lab-0007');
  });
});

describe('paths', () => {
  it('accepts relative experiment paths', () => {
    for (const path of ['run_conceptual.py', 'labs/lab-0007/outputs/canonical.txt', 'docs/a_b-c.md']) {
      expect(() => assertPath(path)).not.toThrow();
    }
  });

  it('rejects absolute, traversing, empty-segment and non-ascii paths', () => {
    for (const path of ['/etc/passwd', '../secrets', 'a/../../b', 'a//b', 'has space.txt', '中文.md']) {
      expect(() => assertPath(path)).toThrow();
    }
  });
});

describe('snapshot identity', () => {
  it('is order independent and content sensitive', async () => {
    const a = await treeSha([{ path: 'a.py', sha256: '11' }, { path: 'b.py', sha256: '22' }]);
    const b = await treeSha([{ path: 'b.py', sha256: '22' }, { path: 'a.py', sha256: '11' }]);
    const c = await treeSha([{ path: 'a.py', sha256: '11' }, { path: 'b.py', sha256: '33' }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes bytes the way the blob endpoint checks them', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('diff', () => {
  it('splits added / removed / changed / unchanged', () => {
    const diff = diffSnapshots(
      [
        { path: 'keep.py', sha256: 'aa' },
        { path: 'edit.py', sha256: 'bb' },
        { path: 'gone.py', sha256: 'cc' },
      ],
      [
        { path: 'keep.py', sha256: 'aa' },
        { path: 'edit.py', sha256: 'dd' },
        { path: 'new.py', sha256: 'ee' },
      ],
    );
    expect(diff.unchanged).toBe(1);
    expect(diff.changed).toEqual(['edit.py']);
    expect(diff.added).toEqual(['new.py']);
    expect(diff.removed).toEqual(['gone.py']);
  });
});

describe('project tokens', () => {
  it('round-trips through the bearer format', async () => {
    const minted = await mintProjectToken();
    expect(minted.token.startsWith('alb_')).toBe(true);
    const parsed = parseProjectToken(minted.token);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(minted.id);
    expect(await tokenFingerprint(parsed!.id, parsed!.secret)).toBe(minted.secretSha256);
  });

  it('refuses malformed tokens', () => {
    expect(parseProjectToken('cyb_abc_def')).toBeNull();
    expect(parseProjectToken('alb_nounderscore')).toBeNull();
  });
});
