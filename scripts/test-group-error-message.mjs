import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/pages/dashboard/groups/MyGroupsTab.tsx', import.meta.url), 'utf8');
const body = source.match(/const fetchGroups = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[sessionId\]\);/)[1];
async function run(error) {
  let message = '', phase = '';
  const context = {
    sessionId: 'test-session', env: {},
    fetch: async () => ({ ok: false, json: async () => ({ error }) }),
    setPhase: value => { phase = value; }, setErrMsg: value => { message = value; },
    setGroups: () => {},
  };
  const code = ts.transpileModule(`(async () => {${body.replaceAll('import.meta.env', 'env')}})()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  await vm.runInNewContext(code, context);
  return { message, phase };
}

test('expired session explains the cause and recovery in Arabic, not the server message', async () => {
  const result = await run({ code: 'SESSION_EXPIRED', message: 'Session 76211b3a is NOT logged in (guest). Cookies expired or invalid. Please re-import cookies.' });
  assert.equal(result.phase, 'error');
  assert.match(result.message, /الجلسة غير نشطة/);
  assert.match(result.message, /أعد ربط/);
  assert.doesNotMatch(result.message, /Session|Cookies|76211b3a/);
});
