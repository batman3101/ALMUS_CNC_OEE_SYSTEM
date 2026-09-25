const { chromium } = require('C:/Users/USER/.agents/skills/gstack/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const checks=[];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS:',name);};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8765'))external.push(r.url());});
  await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>window.setupTask);
  const state=()=>page.evaluate(()=>previewState());
  const search=async id=>{await page.locator('#search').fill(String(id));await page.locator('#searchForm button').click();};
  await check('Publish requires changes; six targets apply immediately as pending',async()=>{
   assert.equal(await page.locator('#setupPublish').isDisabled(),true);await page.locator('#demo').click();await page.locator('#setupPublish').click();
   const s=await state();assert.equal(s.mode,'setup');assert.equal(Object.keys(s.setup.tasks).length,6);assert.ok(Object.values(s.setup.tasks).every(t=>t.status==='pending'));
   assert.equal(s.setup.tasks[305].target.model,'ON1');assert.match(await page.locator('#setupTarget').innerText(),/ON1-C1/);assert.equal(await page.locator('#setupComplete').isVisible(),false);
  });
  await check('Start and complete are sequential; events and completed count retained',async()=>{
   await page.locator('#setupStart').click();assert.equal((await state()).setup.tasks[305].status,'in_progress');assert.equal(await page.locator('#setupStart').isVisible(),false);
   await page.locator('#setupComplete').click();assert.equal((await state()).setup.tasks[305].status,'completed');assert.equal((await state()).setup.tasks[305].events.length,3);
   assert.match(await page.locator('#setupCounts').innerText(),/완료 1/);assert.equal(await page.locator('.machine[data-id="305"]').getAttribute('data-setup'),'completed');
   await search(306);await page.locator('#setupStart').click();
  });
  await check('Setup filters and unaffected machines have no action buttons',async()=>{
   await page.selectOption('#setupFilter','in_progress');assert.equal(await page.locator('.machine:not(.dim)[data-setup="in_progress"]').count(),1);
   await search(1);assert.match(await page.locator('#setupState').innerText(),/대상 아님/);assert.equal(await page.locator('#setupStart').isVisible(),false);assert.equal(Object.keys((await state()).setup.tasks).length,6);
  });
  await check('Draft edit and undo cannot alter the applied target or setup history',async()=>{
   const before=(await state()).setup;await search(305);await page.locator('[data-mode="draft"]').click();await page.selectOption('#editModel','PA1');await page.locator('#applyEdit').click();assert.deepEqual((await state()).setup,before);
   await page.locator('#undo').click();assert.deepEqual((await state()).setup,before);assert.equal(await page.locator('#setupPublish').isDisabled(),true);
   assert.equal(await page.locator('.review-box button').isDisabled(),true);
  });
  await check('Setup persists after reload; Korean/Vietnamese state labels',async()=>{
   await page.reload();await page.locator('[data-mode="setup"]').click();await search(305);assert.equal((await state()).setup.tasks[305].status,'completed');
   await page.selectOption('#language','vi');assert.match(await page.locator('#setupState').innerText(),/Hoàn tất/);await page.selectOption('#language','ko');
   await page.waitForTimeout(3500);await page.screenshot({path:path.join(__dirname,'screenshots/setup-desktop.png'),fullPage:true});
  });
  await check('360px mobile can start/complete setup with no horizontal overflow',async()=>{
   await page.setViewportSize({width:360,height:800});await search(315);await page.locator('#setupStart').click();await page.locator('#setupComplete').click();assert.equal((await state()).setup.tasks[315].status,'completed');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.waitForTimeout(3500);await page.screenshot({path:path.join(__dirname,'screenshots/setup-mobile.png'),fullPage:true});
  });
  await check('Storage failure does not optimistically mark setup started',async()=>{
   await search(316);await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('test storage failure');};});await page.locator('#setupStart').click();assert.equal((await state()).setup.tasks[316].status,'pending');assert.match(await page.locator('#toast').innerText(),/실패/);
  });
  await check('No JavaScript errors or external/production requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[]);});
  fs.writeFileSync(path.join(__dirname,'setup-verification.json'),JSON.stringify({result:'PASS',timestamp:new Date().toISOString(),checks,limitations:['Browser-only example: no backend, real authorization, concurrent clients or production/OEE integration tested']},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
