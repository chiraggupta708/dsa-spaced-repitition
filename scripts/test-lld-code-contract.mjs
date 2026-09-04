#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  LLD_CODE_STATUSES,
  normalizeLldCode,
  normalizeLldDesign,
} from '../lib/lld-contract.js';

const source = 'public class Main { public static void main(String[] args) {} }';
const code = normalizeLldCode({
  language: 'java',
  filename: 'Main.java',
  backgroundMd: 'Starter context from the interviewer.',
  skeletonMd: 'interface PaymentPolicy { }\nclass VendingMachine { }',
  methodSignaturesMd: 'public Selection select(String code);',
  source,
});

assert.deepEqual(code, {
  language: 'java',
  filename: 'Main.java',
  backgroundMd: 'Starter context from the interviewer.',
  skeletonMd: 'interface PaymentPolicy { }\nclass VendingMachine { }',
  methodSignaturesMd: 'public Selection select(String code);',
  source,
  compileStatus: 'not_run',
  compileOutput: '',
});
assert.deepEqual(LLD_CODE_STATUSES, ['not_run', 'passed', 'failed']);

const design = normalizeLldDesign({
  title: 'Parking Lot',
  problemStatementMd: 'Park vehicles.',
  code: {
    language: 'java',
    filename: 'Main.java',
    backgroundMd: 'Starter context from the interviewer.',
    skeletonMd: 'class ParkingLot { }',
    methodSignaturesMd: 'public Ticket park(Vehicle vehicle);',
    source,
  },
});
assert.equal(design.code.language, 'java');
assert.equal(design.code.filename, 'Main.java');
assert.equal(design.code.compileStatus, 'not_run');

assert.throws(() => normalizeLldCode({ language: 'python', source }), /language.*java/i);
assert.throws(() => normalizeLldCode({ language: 'java', filename: '../Main.java', source }), /filename/i);
assert.throws(() => normalizeLldCode({ language: 'java', filename: 'Main.txt', source }), /filename/i);
assert.throws(() => normalizeLldCode({ language: 'java', filename: 'Main.java', source, owner_id: 'attacker' }), /identity field|must not be supplied/i);
assert.throws(() => normalizeLldCode({ language: 'java', filename: 'Main.java', source, compileStatus: 'passed' }), /compileStatus.*server/i);

const blank = normalizeLldDesign({ title: 'Blank LLD' });
assert.deepEqual(blank.code, {
  language: 'java',
  filename: 'Main.java',
  backgroundMd: '',
  skeletonMd: '',
  methodSignaturesMd: '',
  source: '',
  compileStatus: 'not_run',
  compileOutput: '',
});

assert.throws(() => normalizeLldCode({
  language: 'java',
  filename: 'Main.java',
  skeletonMd: 'x'.repeat(20_001),
}), /skeletonMd.*20,?000/i);

console.log('LLD Java code contract tests passed.');
