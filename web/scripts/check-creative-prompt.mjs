import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url=process.env.CHECK_WEB || 'http://localhost:5174'
const photo=await readFile(new URL('../../samples/photo.png',import.meta.url))
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']})
try {
 const page=await browser.newPage({viewport:{width:1400,height:1050}})
 const submissions=[]
 const job={schema_version:1,job_id:'target-check',kind:'pipeline',provider:'fixture',status:'succeeded',stage:'complete',provider_task_id:null,provider_tasks:{},progress:100,artifacts:{source:'/v1/mock/source'},placement:null,error:null,warnings:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
 await page.route('**/v1/**',async route=>{
   const request=route.request()
   if(request.url().endsWith('/mock/source'))return route.fulfill({body:photo,contentType:'image/png'})
   if(request.url().endsWith('/health'))return route.fulfill({json:{schema_version:1,provider:'fixture',live:false,submissions_used:0}})
   if(request.method()==='POST'){
     const body=request.postData()
     const target=Number(body.match(/name="target_polycount"\r\n\r\n(\d+)/)?.[1])
     submissions.push({target,prompt:body.match(/name="prompt"\r\n\r\n([\s\S]*?)\r\n--/)?.[1],key:request.headers()['idempotency-key']})
     job.target_polycount=target
   }
   return route.fulfill({json:job})
 })
 await page.addInitScript(() => {
   if (!localStorage.getItem('groundtruth.session.v1')) localStorage.setItem('groundtruth.session.v1', JSON.stringify({
     jobId:'target-check',fingerprint:null,attempt:0,address:'Test',presetId:'scorched',prompt:'Scorched facade',strength:0.8,targetPolycount:60000,stage:'redesign',
     geo:{query:'Test',displayName:'Test footprint',lat:37.2,lon:-80.4,footprint:[{x:0,z:0},{x:20,z:0},{x:20,z:10},{x:0,z:10}],footprintLatLon:[],neighbors:[],source:'demo',bucket:'test',areaM2:200}
   }))
 })
 await page.goto(url)
 const input=page.getByLabel('Creative prompt')
 await input.waitFor()
 const generate=page.getByRole('button',{name:'Regenerate concept',exact:true})
 await input.fill('   ')
 assert.ok(await generate.isDisabled())
 await input.fill('x'.repeat(2001))
 assert.ok(await generate.isDisabled())
 const custom='White stone facade with blue glazing and rooftop gardens.'
 await input.fill(custom)
 await page.getByRole('button',{name:'+ Warm terracotta',exact:true}).click()
 const submitted=await input.inputValue()
 assert.ok(submitted.startsWith(custom))
 assert.ok(submitted.includes('terracotta'))
 const sent=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/v1/jobs'))
 await generate.click()
 await sent
 assert.equal(submissions[0].prompt,submitted)
 await page.reload()
 await input.waitFor()
 assert.equal(await input.inputValue(),submitted)
 await input.fill('Blue facade with cyan neon lighting.')
 const second=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/v1/jobs'))
 await generate.click()
 await second
 assert.notEqual(submissions[0].key,submissions[1].key)
 assert.equal(submissions[1].prompt,'Blue facade with cyan neon lighting.')
 // Exercise the actual canvas renderer with identical source, preset and strength.
 const preview=await page.evaluate(async()=>{
   const {simulateRedesign,samplePhoto}=await import('/src/lib/redesign.ts')
   const {PRESETS}=await import('/src/lib/presets.ts')
   const source=samplePhoto()
   const outputs=[]
   for(const prompt of ['Red facade','Blue facade','Ivy and moss','Cyan neon lighting','Red facade']) {
     outputs.push(await simulateRedesign(source,PRESETS[0],0.8,()=>{},prompt))
   }
   return {distinct:new Set(outputs.slice(0,4)).size,repeatable:outputs[0]===outputs[4]}
 })
 assert.equal(preview.distinct,4)
 assert.ok(preview.repeatable)
 await page.screenshot({path:'/tmp/groundtruth-creative-prompt.png',fullPage:true})
 console.log('PASS: prompt validation, idea append, request text, refresh persistence, changed generation key, and distinct repeatable canvas previews. API calls mocked.')

} finally {await browser.close()}
