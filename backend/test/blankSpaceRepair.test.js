const test = require('node:test');
const assert = require('node:assert/strict');
const { repairedClassName, repairBlankSpace } = require('../src/services/ai/blankSpaceRepair');

test('blank-space repair strips only oversized fixed heights and padding of the offending element', () => {
  const className = 'relative w-full min-h-[21063.9px] pt-[633px] max-[767px]:pt-[12px]';
  assert.equal(repairedClassName(className, { empty: false, trailing: 20000, leading: 633, gap: 20633, height: 21063 }), 'relative w-full pt-[48px] max-[767px]:pt-[12px]');
});

test('blank-space repair edits the exact class attribute and leaves other elements alone', () => {
  const source = '<section className="h-[490px] w-full bg-black" /><section className="h-[490px] w-full bg-black p-4" />';
  const result = repairBlankSpace([{ path: 'src/A.jsx', content: source }], [{ className: 'h-[490px] w-full bg-black', empty: true, trailing: 0, leading: 490, gap: 490, height: 490 }]);
  assert.equal(result.files[0].content, '<section className="w-full bg-black" /><section className="h-[490px] w-full bg-black p-4" />');
  assert.equal(result.changed, 1);
});
