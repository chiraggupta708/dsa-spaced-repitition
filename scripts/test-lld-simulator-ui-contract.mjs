#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /function lldTemplatePayload\(kind\)/);
assert.match(html, /function lldStartTemplatePractice\(kind,mode\)/);
assert.match(html, /lldApi\('\/api\/designs\/lld',\{method:'POST'/);
assert.match(html, /else lldStartTemplatePractice\('vending',mode\)/);
assert.match(html, /function lldStartPractice\(id,mode\)/);
assert.match(html, /lldApi\('\/api\/designs\/lld\?lldId='/);
assert.match(html, /var lldBaselineGuidance=\{/);
assert.match(html, /Minimum reference checklist/);
assert.match(html, /if\(saved\)return saved/);
assert.match(html, /Reference guidance/);
assert.doesNotMatch(html, /No notebook guidance saved for this phase yet/);
assert.match(html, /id="lldCodeBackground"/);
assert.match(html, /id="lldCodeSource"/);
assert.match(html, /code:\{language:'java',filename:'Main\.java'/);
assert.match(html, /key:'code'/);
assert.match(html, /id="lldSimulatorSkeleton"/);
assert.match(html, /id="lldSimulatorMethods"/);
assert.match(html, /id="lldSimulatorAiReview"/);
assert.match(html, /id="lldSimulatorAiHint"/);
assert.match(html, /id="lldSimulatorAiFollowup"/);
assert.match(html, /id="lldSimulatorAiDebrief"/);
assert.match(html, /id="lldCodeHistoryButton"/);
assert.match(html, /action=code-versions/);
assert.match(html, /action=ai/);
assert.match(html, /action=code/);

console.log('LLD simulator UI contract tests passed.');
