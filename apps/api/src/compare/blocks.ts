import { activityKeys, cmp, roomKey } from './keys.js';
import type { Activity, Block, SessionLike } from './types.js';

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

function sameActivity(a: Activity, b: Activity): boolean {
  return (
    a.teachersKey === b.teachersKey &&
    a.groupsKey === b.groupsKey &&
    a.subjectCodeKey === b.subjectCodeKey &&
    a.subjectKey === b.subjectKey &&
    a.frequencyKey === b.frequencyKey
  );
}

/**
 * Merge consecutive slots of the same session on the same day and room into one block
 * (FET rowspan sessions arrive as one row per covered slot). Output is sorted
 * deterministically by (day, slot, room, activity).
 */
export function buildBlocks(sessions: SessionLike[]): Block[] {
  const sorted = [...sessions].sort(
    (a, b) =>
      a.day - b.day ||
      a.slot - b.slot ||
      cmp(a.room, b.room) ||
      cmp(a.teachers, b.teachers) ||
      cmp(a.groups, b.groups) ||
      cmp(a.subjectCode, b.subjectCode) ||
      cmp(a.subject, b.subject) ||
      cmp(a.frequency, b.frequency),
  );

  const blocks: Block[] = [];
  for (const s of sorted) {
    const activity: Activity = {
      teachers: s.teachers,
      groups: s.groups,
      subjectCode: s.subjectCode,
      subject: s.subject,
      frequency: s.frequency,
      ...activityKeys(s),
    };
    const roomK = roomKey(s.room);
    const last = blocks[blocks.length - 1];
    if (
      last &&
      last.day === s.day &&
      last.roomKey === roomK &&
      sameActivity(last.activity, activity) &&
      s.slot === last.lastSlot + 1
    ) {
      last.lastSlot = s.slot;
      continue;
    }
    blocks.push({ day: s.day, firstSlot: s.slot, lastSlot: s.slot, room: s.room, roomKey: roomK, activity });
  }
  return blocks.sort(blockOrder);
}
