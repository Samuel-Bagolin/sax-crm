const assert = require('node:assert/strict');
const {parseNumber, csvCell} = require('../src/lib/numbers.ts');
for (const [text, expected] of [['1234.56',1234.56],['1.234,56',1234.56],['1234,56',1234.56],['0.10',.1],['-100.25',-100.25],['',null],['NaN',null],['1,2,3',null],['10 reais',null]]) assert.equal(parseNumber(text), expected);
assert.equal(csvCell('a;"b"\nnext'),'"a;""b""\nnext"');
assert.equal(csvCell('=HYPERLINK("example")'),'"\'=HYPERLINK(""example"")"');
assert.equal(csvCell(' +SUM(1)'), '"\' +SUM(1)"');
assert.equal(csvCell(1234.56),'"1234,56"');
console.log('13 numeric/CSV regression cases passed');
