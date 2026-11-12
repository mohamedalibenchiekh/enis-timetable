import { activityKey, cmp } from './keys.js';
import type { Block, ChangeType } from './types.js';

export interface BlockMatch {
  type: ChangeType;
  base?: Block;
  target?: Block;
}

export interface MatchResult {
  /** Only actual changes (added/removed/moved/room_changed/group_changed/teachers_changed). */
  matches: BlockMatch[];
  /** Number of identical block pairs. */
  unchanged: number;
}

const blockOrder = (a: Block, b: Block): number =>
  a.day - b.day ||
  a.firstSlot - b.firstSlot ||
  a.lastSlot - b.lastSlot ||
  cmp(a.roomKey, b.roomKey) ||
  cmp(a.activity.teachersKey, b.activity.teachersKey) ||
  cmp(a.activity.groupsKey, b.activity.groupsKey) ||
  cmp(a.activity.subjectCodeKey, b.activity.subjectCodeKey) ||
  cmp(a.activity.subjectKey, b.activity.subjectKey) ||
  cmp(a.activity.frequencyKey, b.activity.frequencyKey);

function bucket(blocks: Block[], key: (b: Block) => string): Map<string, Block[]> {
  const map = new Map<string, Block[]>();
  for (const b of blocks) {
    const k = key(b);
    const arr = map.get(k);
    if (arr) arr.push(b);
    else map.set(k, [b]);
  }
  return map;
}

/** Remove and return the first block of `map[key]` satisfying `pred` (default: first). */
function take(map: Map<string, Block[]>, key: string, pred?: (b: Block) => boolean): Block | undefined {
  const arr = map.get(key);
  if (!arr?.length) return undefined;
  const i = pred ? arr.findIndex(pred) : 0;
  if (i < 0) return undefined;
  const [b] = arr.splice(i, 1);
  if (!arr.length) map.delete(key);
  return b;
}

const identicalKey = (b: Block): string =>
  [b.day, b.firstSlot, b.lastSlot, b.roomKey, activityKey(b.activity)].join('|');

/** Same day + slot range + room + groups + subject + frequency, different teachers. */
const teachersChangedKey = (b: Block): string =>
  [b.day, b.firstSlot, b.lastSlot, b.roomKey, b.activity.groupsKey, b.activity.subjectCodeKey, b.activity.subjectKey, b.activity.frequencyKey].join('|');

/** Same activity, same day + slot range, any room (room must differ — checked by caller). */
const roomChangedKey = (b: Block): string => [activityKey(b.activity), b.day, b.firstSlot, b.lastSlot].join('|');

/** Same everything except groups: teachers + subject (code, title) + frequency + room + day/slots. */
const groupChangedKey = (b: Block): string =>
  [
    b.activity.teachersKey,
    b.activity.subjectCodeKey,
    b.activity.subjectKey,
    b.activity.frequencyKey,
    b.roomKey,
    b.day,
    b.firstSlot,
    b.lastSlot,
  ].join('|');

const sameLocation = (a: Block, b: Block): boolean =>
  a.day === b.day && a.firstSlot === b.firstSlot && a.lastSlot === b.lastSlot && a.roomKey === b.roomKey;

/**
 * Deterministic multi-pass matching between two block lists. Every pass consumes the
 * blocks it matches so no block is counted twice. O(n log n).
 */
export function matchBlocks(baseIn: Block[], targetIn: Block[]): MatchResult {
  const baseSorted = [...baseIn].sort(blockOrder);
  const targetSorted = [...targetIn].sort(blockOrder);
  const bUsed = new Set<Block>();
  const tUsed = new Set<Block>();
  const matches: BlockMatch[] = [];
  let unchanged = 0;

  const baseLeft = () => baseSorted.filter((b) => !bUsed.has(b));
  const targetLeft = () => targetSorted.filter((t) => !tUsed.has(t));

  // Pass A — identical block in both versions → unchanged.
  {
    const map = bucket(targetSorted, identicalKey);
    for (const b of baseSorted) {
      const t = take(map, identicalKey(b));
      if (t) {
        bUsed.add(b);
        tUsed.add(t);
        unchanged++;
      }
    }
  }

  // Pass B — same position/room/groups/subject, different teacher set → teachers_changed.
  {
    const map = bucket(targetLeft(), teachersChangedKey);
    for (const b of baseLeft()) {
      const t = take(map, teachersChangedKey(b), (x) => x.activity.teachersKey !== b.activity.teachersKey);
      if (t) {
        bUsed.add(b);
        tUsed.add(t);
        matches.push({ type: 'teachers_changed', base: b, target: t });
      }
    }
  }

  // Pass C — same activity, same day and slots, different room → room_changed.
  {
    const map = bucket(targetLeft(), roomChangedKey);
    for (const b of baseLeft()) {
      const t = take(map, roomChangedKey(b), (x) => x.roomKey !== b.roomKey);
      if (t) {
        bUsed.add(b);
        tUsed.add(t);
        matches.push({ type: 'room_changed', base: b, target: t });
      }
    }
  }

  // Pass D — same activity, remaining blocks paired in stable order → moved.
  // Surplus blocks of an activity present on both sides → added / removed.
  {
    const byActivity = (blocks: Block[]) => {
      const map = new Map<string, Block[]>();
      for (const b of blocks) {
        const k = activityKey(b.activity);
        const arr = map.get(k);
        if (arr) arr.push(b);
        else map.set(k, [b]);
      }
      for (const arr of map.values()) arr.sort(blockOrder);
      return map;
    };
    const baseMap = byActivity(baseLeft());
    const targetMap = byActivity(targetLeft());
    for (const [key, bArr] of baseMap) {
      const tArr = targetMap.get(key);
      if (!tArr) continue;
      const n = Math.min(bArr.length, tArr.length);
      for (let i = 0; i < n; i++) {
        const b = bArr[i];
        const t = tArr[i];
        bUsed.add(b);
        tUsed.add(t);
        if (!sameLocation(b, t)) matches.push({ type: 'moved', base: b, target: t });
        else unchanged++;
      }
      for (let i = n; i < bArr.length; i++) {
        bUsed.add(bArr[i]);
        matches.push({ type: 'removed', base: bArr[i] });
      }
      for (let i = n; i < tArr.length; i++) {
        tUsed.add(tArr[i]);
        matches.push({ type: 'added', target: tArr[i] });
      }
      targetMap.delete(key);
    }
    // Activities only present on the target side stay in targetMap → handled by pass F.
  }

  // Pass E — same teacher + subject code + day/slots, different groups → group_changed.
  {
    const map = bucket(targetLeft(), groupChangedKey);
    for (const b of baseLeft()) {
      const t = take(map, groupChangedKey(b), (x) => x.activity.groupsKey !== b.activity.groupsKey);
      if (t) {
        bUsed.add(b);
        tUsed.add(t);
        matches.push({ type: 'group_changed', base: b, target: t });
      }
    }
  }

  // Pass F — everything left → removed (base only) / added (target only).
  for (const b of baseLeft()) matches.push({ type: 'removed', base: b });
  for (const t of targetLeft()) matches.push({ type: 'added', target: t });

  // Deterministic ordering: day, slot, teacher, subject, group, type.
  matches.sort((a, b2) => {
    const ka = matchSortKey(a);
    const kb = matchSortKey(b2);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { matches, unchanged };
}

function matchSortKey(m: BlockMatch): string {
  const primary = (m.target ?? m.base)!;
  const secondary = (m.base ?? m.target)!;
  const day = Math.min(primary.day, secondary.day);
  const slot = Math.min(primary.firstSlot, secondary.firstSlot);
  return [
    String(day).padStart(3, '0'),
    String(slot).padStart(3, '0'),
    primary.activity.teachersKey,
    primary.activity.subjectCodeKey,
    primary.activity.groupsKey,
    m.type,
  ].join('|');
}
