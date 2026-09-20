import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile, mkdir} from 'node:fs/promises'
import {unzipSync, zipSync, strToU8, strFromU8} from 'fflate'
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.CHECK_WEB || 'http://localhost:5175'
const out = '/tmp/groundtruth-bundle-check'
await mkdir(out, {recursive:true})
const original = await readFile(new URL('../public/examples/dds/bundle.zip', import.meta.url))
const files = unzipSync(original)
const placement = JSON.parse(strFromU8(files['placement.json']))
const b = await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']})
try {
 const page = await b.newPage({viewport:{width:1440,height:1050}})
 const errors=[], requests=[]
 page.on('pageerror', e=>errors.push(e.message))
 page.on('request', r=>{if(r.url().includes('/v1/'))requests.push(r.url())})
 await page.route('**/*', route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort())
 await page.goto(url)
 const upload = async buffer=>page.getByLabel('Saved Groundtruth ZIP').setInputFiles({name:'saved-design.zip',mimeType:'application/zip',buffer})
 await upload(original)
 await page.getByRole('button',{name:'Walk around',exact:true}).waitFor({timeout:60000})
 await page.getByText('Imported bundle · meshy',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Walk around',exact:true}).click()
 await page.getByRole('button',{name:'Orbit view',exact:true}).click()
 await page.getByRole('button',{name:'Inspect / export',exact:true}).click()
 await page.getByTestId('placement-status').filter({hasText:'rejected'}).waitFor()
 await page.getByText('Inspect placement, metrics and transform',{exact:true}).click()
 const matrix=[]
 for(let r=0;r<4;r++)for(let c=0;c<4;c++)matrix.push((Math.abs(placement.selected.matrix_column_major[c*4+r])<1e-9?0:placement.selected.matrix_column_major[c*4+r]).toFixed(4))
 assert.deepEqual(await page.locator('.matrix span').allTextContents(),matrix)
 const download=page.waitForEvent('download')
 await page.getByRole('button',{name:'Export model + placement',exact:true}).click()
 await (await download).saveAs(`${out}/reexport.zip`)
 assert.deepEqual(await readFile(`${out}/reexport.zip`),original)
 await page.reload()
 await page.getByRole('button',{name:'Walk around',exact:true}).waitFor({timeout:60000})
 await page.locator('canvas').waitFor({state:'visible'})
 await page.waitForTimeout(2000)
 await page.screenshot({path:`${out}/imported-explore.png`,fullPage:true})
 await page.getByRole('button',{name:/Redesign/}).click()
 await page.getByText('Modern Hokie Stone academic building with large glass curtain walls, preserve roofline and massing.',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Generate concept',exact:true}).count(),0)
 await page.getByRole('button',{name:'New',exact:true}).click()
 await page.reload()
 await page.getByRole('button',{name:'Open saved ZIP',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>localStorage.getItem('groundtruth.bundle.v1')),null)
 // Changed bytes and malformed transforms must not replace the current project.
 for(const [patch, message] of [
   [{'model.glb':new Uint8Array([1,2,3])},'Hash mismatch'],
   [{'source.png':new Uint8Array([1,2,3])},'Hash mismatch'],
   [{'placement.json':strToU8(JSON.stringify({...placement,selected:{...placement.selected,matrix_column_major:[0,1]}}))},'Invalid placement.json'],
   [{'placement.json':strToU8(JSON.stringify({...placement,asset_sha256:'0'.repeat(64)}))},'does not match'],
 ]) {
   await upload(Buffer.from(zipSync({...files,...patch})))
   await page.getByRole('alert').filter({hasText:message}).waitFor({timeout:60000})
   assert.equal(await page.evaluate(()=>localStorage.getItem('groundtruth.bundle.v1')),null)
 }
 // A failed import must leave an already-open result intact.
 await upload(original)
 await page.getByRole('button',{name:'Walk around',exact:true}).waitFor({timeout:60000})
 await page.getByRole('button',{name:/Ingest/}).click()
 await upload(Buffer.from(zipSync({...files,'placement.json':strToU8('{}')})))
 await page.getByRole('alert').filter({hasText:'Invalid placement.json'}).waitFor()
 assert.equal(await page.evaluate(()=>localStorage.getItem('groundtruth.bundle.v1')),'current')
 await page.getByRole('button',{name:/Explore/}).click()
 await page.getByRole('button',{name:'Walk around',exact:true}).waitFor()
 assert.deepEqual(requests,[])
 assert.deepEqual(errors,[])
 console.log('PASS: ZIP import, orbit/walk, matrix, exact re-export, refresh, source provenance, New reset, and corrupt bundle rejection without API/GIS.')
} finally {await b.close()}
