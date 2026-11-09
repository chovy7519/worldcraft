import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

test('both offline deliverables compile without module scope collisions or external scripts',()=>{
  execFileSync(process.execPath,['build.mjs'],{cwd:new URL('..',import.meta.url)});
  for(const file of ['worldcraft.html','mountain-village.html']){
    const html=readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(html,/<script[^>]*\bsrc=/);
    assert.doesNotMatch(html,/<link[^>]*rel="stylesheet"/);
    const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(()=>new Script(script,{filename:file}));
  }
});
