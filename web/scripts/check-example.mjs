import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url=process.env.CHECK_WEB || 'http://localhost:5175'
const out='/tmp/groundtruth-example-check'
await mkdir(out,{recursive:true})
const b=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']})
try {
 const page=await b.newPage({viewport:{width:1440,height:1050}})
 const errors=[],apiRequests=[]
 page.on('pageerror',e=>errors.push(e.message))
 page.on('request',r=>{if(r.url().includes('/v1/'))apiRequests.push(r.url())})
 await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort())
 await page.goto(url)
 await page.getByRole('button',{name:'Load completed real example',exact:true}).click()
 await page.getByRole('button',{name:'Walk around',exact:true}).waitFor({timeout:60000})
 assert.ok(await page.getByText('Cached real example · Meshy',{exact:true}).isVisible())
 await page.waitForTimeout(1500)
 await page.screenshot({path:`${out}/optimized-explore.png`,fullPage:true})
 await page.getByText('Source photo and prompt',{exact:true}).click()
 assert.ok(await page.getByText('Modern Hokie Stone academic building with large glass curtain walls, preserve roofline and massing.',{exact:true}).isVisible())
 await page.getByRole('button',{name:'Walk around',exact:true}).click()
 await page.getByRole('button',{name:'Orbit view',exact:true}).waitFor()
 await page.getByRole('button',{name:'Reset camera',exact:true}).click()
 await page.getByRole('button',{name:'Orbit view',exact:true}).click()
 await page.getByRole('button',{name:'Inspect / export',exact:true}).click()
 await page.getByTestId('placement-status').filter({hasText:'rejected'}).waitFor()
 const event=page.waitForEvent('download')
 await page.getByRole('button',{name:'Export model + placement',exact:true}).click()
 await (await event).saveAs(`${out}/bundle.zip`)
 execFileSync('python3',['-c',`
import zipfile,json,hashlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 p=json.loads(z.read('placement.json'));g=json.loads(z.read('generation.json'))
 assert hashlib.sha256(z.read('model.glb')).hexdigest()==p['asset_sha256']==g['sha256']['model']
 assert p['plan_fit']=='rejected'
 assert g['derived_asset']['triangles']<65000
 assert g['derived_asset']['source_sha256']!=p['asset_sha256']
 `,`${out}/bundle.zip`])
 await page.reload()
 await page.getByRole('button',{name:'Walk around',exact:true}).waitFor({timeout:60000})
 assert.equal(await page.evaluate(()=>localStorage.getItem('groundtruth.example.v1')),'dds')
 // A malformed pairing must not be presented as the validated cached example.
 await page.getByRole('button',{name:'New',exact:true}).click()
 await page.route('**/examples/dds/example.json',async route=>{
  const response=await route.fetch();const data=await response.json()
  data.placement.asset_sha256='0'.repeat(64)
  await route.fulfill({response,json:data})
 })
 await page.getByRole('button',{name:'Load completed real example',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'does not match'}).waitFor({timeout:60000})
 assert.equal(await page.evaluate(()=>localStorage.getItem('groundtruth.example.v1')),null)
 assert.deepEqual(apiRequests,[])
 assert.deepEqual(errors,[])
 console.log('PASS: static production example loads, explores, exports and restores without API/GIS; corrupt hash rejected; no page errors.')
} finally {await b.close()}
