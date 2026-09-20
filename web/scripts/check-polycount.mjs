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
     submissions.push({target,key:request.headers()['idempotency-key']})
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
 const input=page.getByLabel('Target polygons for 3D')
 assert.equal(await input.inputValue(),'60000')
 await input.fill('99')
 assert.ok(await page.getByRole('button',{name:'Regenerate concept',exact:true}).isDisabled())
 await input.fill('12000')
 const sent = page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/v1/jobs'))
 await page.getByRole('button',{name:'Regenerate concept',exact:true}).click()
 await sent
 await page.getByRole('button',{name:'Regenerate concept',exact:true}).waitFor()
 assert.equal(submissions[0].target,12000)
 await page.reload()
 await page.getByLabel('Target polygons for 3D').waitFor()
 assert.equal(await page.getByLabel('Target polygons for 3D').inputValue(),'12000')
 await page.getByLabel('Target polygons for 3D').fill('30000')
 const sentAgain = page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/v1/jobs'))
 await page.getByRole('button',{name:'Regenerate concept',exact:true}).click()
 await sentAgain
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('groundtruth.session.v1')).targetPolycount===30000)
 await page.waitForTimeout(250)
 assert.equal(submissions[1].target,30000)
 assert.notEqual(submissions[0].key,submissions[1].key)
 await page.screenshot({path:'/tmp/groundtruth-polycount.png',fullPage:true})
 console.log('PASS: target control validation, request value, refresh persistence and distinct generation key; all API calls mocked.')
} finally {await browser.close()}
