const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
async function approve(page) { await page.locator('#reviewerAlias').fill('테스트 검토자'); for (const c of await page.locator('[data-review-check]').all()) await c.check(); await page.selectOption('#decision','approved'); }
(async()=>{
 const html=await fs.readFile(path.resolve(__dirname,'../examples/tactics-review-starter/review-pack.html'));
 const server=http.createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404).end();return;}res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')network.push(r.url());});
  await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.locator('#caseList button').count(),48);assert.equal(await page.locator('#exportTraining').isDisabled(),true);
  assert.equal(await page.evaluate(()=>tacticsReviewPack.pack.cases.every(row=>row.review.reviewed===false)),true);
  await page.selectOption('#decision','approved');assert.match(await page.locator('#error').textContent(),/여섯 검토 항목/);
  await approve(page);assert.equal(await page.locator('#exportTraining').isDisabled(),false);
  const pending=page.waitForEvent('download');await page.locator('#exportTraining').click();const downloaded=await pending;
  const rows=(await fs.readFile(await downloaded.path(),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,1);
  const user=JSON.parse(rows[0].messages[1].content),draft=JSON.parse(rows[0].messages[2].content);
  assert.ok(user.board&&['basketball','volleyball'].includes(user.sport)&&user.goal);assert.ok(!Object.hasOwn(user,'request'));
  assert.ok(user.references.length&&user.references.every(row=>!row.sourceUrl));assert.ok(Array.isArray(draft.suggestions));
  assert.ok(rows[0].messages[0].content.includes('초등 체육'));assert.ok(!JSON.stringify(rows).includes('테스트 검토자'));
  await page.selectOption('#splitFilter','evaluation-holdout');assert.equal(await page.locator('#caseList button').count(),12);
  await page.locator('#caseList button').first().click();await approve(page);
  const holdDownload=page.waitForEvent('download');await page.locator('#exportEvaluation').click();const holdFile=await holdDownload;
  const evalPack=JSON.parse(await fs.readFile(await holdFile.path(),'utf8'));assert.equal(evalPack.cases.length,12);assert.ok(evalPack.cases.every(row=>!row.id.endsWith('01')));
  const trainAgain=page.waitForEvent('download');await page.locator('#exportTraining').click();const trainFile=await trainAgain;assert.equal((await fs.readFile(await trainFile.path(),'utf8')).trim().split('\n').length,1,'holdouts must not leak into training');
  await page.selectOption('#splitFilter','');await page.locator('#caseList button').filter({hasText:'B-S01'}).click();
  const observation=page.locator('.answer textarea').first();await observation.fill((await observation.inputValue())+' 배치 표시를 다시 확인하세요.');
  assert.equal(await page.locator('#decision').inputValue(),'pending');assert.equal(await page.locator('#exportTraining').isDisabled(),true);assert.equal(await page.locator('[data-review-check]:checked').count(),0);
  const savedPromise=page.waitForEvent('download');await page.locator('#exportReviews').click();const savedFile=await savedPromise;const saved=JSON.parse(await fs.readFile(await savedFile.path(),'utf8'));
  await page.locator('#importReviews').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...saved,packId:'wrong-pack'}))});
  await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('이 예제 묶음'));
  await page.locator('#importReviews').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('불러왔어요'));
  await page.setViewportSize({width:360,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.scrollTo(0,document.querySelector('#current').getBoundingClientRect().top+scrollY));
  await page.screenshot({path:'/tmp/pe-loop-tactics-review-pack.png',fullPage:false});
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  console.log('48-case synthetic classroom pack: draft review gate, isolated JSONL schema, evaluation isolation, edit invalidation, review import/export, narrow layout and no outbound requests passed.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
