import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mergeConfig, parseConfig } from '../scripts/guards.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const lock=JSON.parse(read('source-lock.json'));
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ax6600-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const name of ['scripts','config'])fs.cpSync(path.join(repo,name),path.join(root,name),{recursive:true});
  fs.copyFileSync(path.join(repo,'source-lock.json'),path.join(root,'source-lock.json'));
  const source=path.join(root,'source');fs.mkdirSync(source);
  const call=mode=>spawnSync(process.execPath,[path.join(root,'scripts','build.mjs'),mode],{
    encoding:'utf8',env:{...process.env,WRT_SOURCE_DIR:source}
  });
  return {root,source,call};
}
test('baseline checksum and every repository revision are fixed',()=>{
  const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'config/plus-original.config'))).digest('hex');
  assert.equal(digest,lock.original_config_sha256);
  for(const p of [lock.builder,lock.firmware,lock.luci_daed,...lock.feeds,...lock.external]) {
    assert.match(p.repo,/^[\w.-]+\/[\w.-]+$/);
    assert.match(p.commit,/^[a-f0-9]{40}$/);
  }
  const original=parseConfig(read('config/plus-original.config'));
  const allSelected=[...original].filter(([key,value])=>key.startsWith('CONFIG_PACKAGE_')&&value==='y');
  assert.deepEqual([...parseConfig(read('config/preserve.config'))],allSelected);
});
test('CLI normalization preserves PLUS and emits a verified config report',t=>{
  const {root,source,call}=fixture(t);
  const requirements='CONFIG_USE_LLVM_HOST=y\nCONFIG_NEED_BPF_TOOLCHAIN=y\nCONFIG_DWARVES=y\n';
  fs.writeFileSync(path.join(source,'.config'),mergeConfig(read('config/plus-original.config'),requirements));
  const normalized=call('normalize');assert.equal(normalized.status,0,normalized.stderr);
  const verified=call('verify-config');assert.equal(verified.status,0,verified.stderr);
  assert.match(fs.readFileSync(path.join(root,'reports','config-changes.txt'),'utf8'),/CONFIG_KERNEL_DEBUG_INFO_BTF: absent -> y/);
  assert.equal(fs.existsSync(path.join(root,'artifacts')),false);
});
for(const removed of ['dockerd','kmod-ath11k'])test(`CLI refuses a dropped ${removed} and never emits firmware`,t=>{
  const {root,source,call}=fixture(t);
  const config=mergeConfig(read('config/plus-original.config'),read('config/daed.config'));
  fs.writeFileSync(path.join(source,'.config'),config.replace(`CONFIG_PACKAGE_${removed}=y`,`# CONFIG_PACKAGE_${removed} is not set`));
  const result=call('verify-artifacts');
  assert.notEqual(result.status,0);
  assert.ok(result.stderr.includes(`CONFIG_PACKAGE_${removed}`),result.stderr);
  assert.equal(fs.existsSync(path.join(root,'artifacts')),false);
});
