// Source-level repair for blank space reported by detectBlankSpace. It only edits the exact class
// string of the offending element, and only fixed pixel height / padding utilities, so content,
// images and every other section stay untouched.
const HEIGHT_TOKEN = /^(?:[\w-]+(?:\[[^\]]*\])?:)*(?:min-)?h-\[[\d.]+px\]$/;
const TOP_PADDING_TOKEN = /^((?:[\w-]+(?:\[[^\]]*\])?:)*)pt-\[([\d.]+)px\]$/;
const BOTTOM_PADDING_TOKEN = /^((?:[\w-]+(?:\[[^\]]*\])?:)*)pb-\[([\d.]+)px\]$/;
const MAX_REMAINING_PADDING = 48;

function repairedClassName(className, finding) {
  const tokens = className.split(/\s+/).filter(Boolean);
  const next = [];
  for (const token of tokens) {
    if (HEIGHT_TOKEN.test(token) && (finding.empty || finding.trailing >= 120 || finding.gap >= finding.height * 0.4)) continue;
    const top = token.match(TOP_PADDING_TOKEN);
    if (top && finding.leading >= 200 && Number(top[2]) > MAX_REMAINING_PADDING) { next.push(`${top[1]}pt-[${MAX_REMAINING_PADDING}px]`); continue; }
    const bottom = token.match(BOTTOM_PADDING_TOKEN);
    if (bottom && finding.trailing >= 200 && Number(bottom[2]) > MAX_REMAINING_PADDING) { next.push(`${bottom[1]}pb-[${MAX_REMAINING_PADDING}px]`); continue; }
    next.push(token);
  }
  return next.join(' ');
}

function repairBlankSpace(files = [], findings = []) {
  let changed = 0;
  const applied = [];
  const updated = files.map((file) => ({ ...file }));
  for (const finding of findings) {
    const replacement = repairedClassName(finding.className, finding);
    if (replacement === finding.className.split(/\s+/).filter(Boolean).join(' ')) continue;
    const matches = updated.filter((file) => file.encoding !== 'base64' && /\.(?:jsx?|tsx?)$/i.test(file.path || '') && String(file.content || '').includes(finding.className));
    if (!matches.length) continue;
    for (const file of matches) {
      const before = file.content;
      // Replace only the exact attribute value; this never touches a longer class string that merely contains it.
      file.content = before.split(`"${finding.className}"`).join(`"${replacement}"`).split(`'${finding.className}'`).join(`'${replacement}'`).split(`\`${finding.className}\``).join(`\`${replacement}\``);
      if (file.content !== before) { changed += 1; applied.push({ path: file.path, from: finding.className.slice(0, 120), to: replacement.slice(0, 120), gap: finding.gap }); }
    }
  }
  return { files: updated, changed, applied };
}

module.exports = { repairBlankSpace, repairedClassName };
