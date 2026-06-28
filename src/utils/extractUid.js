/**
 * Extract a Bilibili UID from free-form user input.
 * Returns { uid: string|null, source: string, confidence: 'high'|'low'|'none' }
 *
 * Recognized formats:
 *   - Plain UID: "453244911"
 *   - Space URL:  "https://space.bilibili.com/453244911" or "space.bilibili.com/453244911/"
 *   - UID label:  "UID: 453244911", "UID453244911", "mid 453244911"
 *   - Mixed text: "查一下 453244911 这个用户"
 *
 * Rejected:
 *   - BV/AV video IDs
 *   - Video page URLs (no embed UID)
 *   - Pure text with no digits
 *   - Digit sequences < 4 chars
 */

export function extractUid(input) {
  // Reject BV/AV video IDs globally
  if (/^(?:BV|AV)\d/i.test((input || "").toUpperCase())) {
    return { uid: null, source: "video-id", confidence: "none" };
  }

  const raw = (input || '').trim();
  if (!raw) return { uid: null, source: 'empty', confidence: 'none' };

  // 1. Bilibili space URL — highest confidence
  const spaceMatch = raw.match(/space\.bilibili\.com\/(\d+)/i);
  if (spaceMatch) {
    return { uid: spaceMatch[1], source: 'space-url', confidence: 'high' };
  }

  // 2. Explicit UID/mid label: "UID: 453244911", "UID453244911", "mid 453244911"
  const labelMatch = raw.match(/(?:uid|mid|用户.?id|成员.?id)\s*[:：]?\s*(\d{4,})/i);
  if (labelMatch) {
    return { uid: labelMatch[1], source: 'uid-label', confidence: 'high' };
  }

  // 3. bilibili.com member URL — /{digits} NOT /video/, /bangumi/, /read/
  const memberUrlMatch = raw.match(/bilibili\.com\/(\d{6,})(?:\/|$|\?)/i);
  if (memberUrlMatch) {
    return { uid: memberUrlMatch[1], source: 'member-url', confidence: 'high' };
  }

  // 4. Free text — find all digit sequences, pick the best candidate
  const digitRuns = [...raw.matchAll(/\d+/g)].map(m => m[0]);

  // Filter out BV/AV-like patterns
  const cleanRuns = digitRuns.filter(d => {
    const pos = raw.indexOf(d);
    const prefix = raw.substring(Math.max(0, pos - 2), pos).toUpperCase();
    return prefix !== 'BV' && prefix !== 'AV';
  });

  if (cleanRuns.length === 0) {
    return { uid: null, source: 'no-digits', confidence: 'none' };
  }

  // Prefer the longest digit run >= 4 chars
  const best = cleanRuns.reduce((a, b) => (b.length >= a.length ? b : a), cleanRuns[0]);

  if (best.length >= 6) {
    return { uid: best, source: 'free-text', confidence: 'high' };
  }
  if (best.length >= 4) {
    return { uid: best, source: 'free-text', confidence: 'low' };
  }
  return { uid: null, source: 'too-short', confidence: 'none' };
}

/** Human-readable error for each extraction source. Returns null when no error. */
export function uidError(source) {
  switch (source) {
    case 'empty':
      return '请输入 B 站 UID 或用户空间链接。';
    case 'no-digits':
      return '未检测到数字 UID。请直接输入 UID（如 453244911）或粘贴用户空间链接（如 space.bilibili.com/453244911）。';
    case 'too-short':
      return '检测到的数字过短，似乎不是有效的 B 站 UID。请输入完整的 UID。';
    default:
      return null;
  }
}
