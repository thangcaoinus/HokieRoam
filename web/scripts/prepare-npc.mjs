// Prepare the HokieBird NPC avatar for the browser. Never modifies samples/ and never contacts
// a provider — it reads the untouched Meshy generation and writes a lighter copy into public/.
//
//   node scripts/prepare-npc.mjs
//
// Why this exists: the raw generation is ~13.6 MB, and almost all of that is texture the avatar
// cannot show. The bird is ~1.9 m tall and the chase camera sits 7.5 m back, so it occupies a
// small part of the frame and never reveals 2k detail. The building it walks around is already
// 19 MB; doubling the demo's download for pixels nobody sees is a bad trade on conference wifi.
//
// What is dropped, and why each is safe here:
//   * normal map  — the largest single texture. Surface relief on fabric fur is invisible at
//                   avatar scale, and it was over half the file.
//   * emissive    — a mascot costume does not emit light.
//   * metal/rough — replaced by constant factors. Fur is uniformly rough and fully dielectric,
//                   so a per-texel map says nothing a scalar cannot.
// The base colour map is kept, because it is the entire reason the model reads as the HokieBird,
// and resized to 1k.
import { NodeIO } from '@gltf-transform/core'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const SOURCE = `${root}samples/hokiebird-npc/model.glb`
const OUT_DIR = `${root}web/public/npc`
const OUT = `${OUT_DIR}/hokiebird.glb`
const BASECOLOR_PX = 1024

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

// Resize a JPEG/PNG with the browser-free path already available to this repo: three.js is not
// usable here, and adding sharp would be a new native dependency. Canvas via `@gltf-transform`'s
// own textureCompress needs sharp too, so downscale by decoding through an ImageDecoder-free
// route: we shell out to `sips`, which ships with macOS, and fall back to leaving the texture
// untouched (still correct, just larger) anywhere it is missing.
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'

function downscale(bytes, mime, px) {
  const ext = mime === 'image/png' ? 'png' : 'jpg'
  const inPath = join(tmpdir(), `npc-tex-${Date.now()}.${ext}`)
  const outPath = join(tmpdir(), `npc-tex-${Date.now()}-out.jpg`)
  try {
    writeFileSync(inPath, bytes)
    execFileSync('sips', ['-Z', String(px), '-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
      inPath, '--out', outPath], { stdio: 'pipe' })
    const out = readFileSync(outPath)
    return out.byteLength < bytes.byteLength ? { bytes: out, mime: 'image/jpeg' } : null
  } catch {
    return null                       // no sips (non-macOS): ship the texture as generated
  } finally {
    for (const p of [inPath, outPath]) { try { rmSync(p) } catch { /* already gone */ } }
  }
}

const io = new NodeIO()
const doc = await io.read(SOURCE)
const srcBytes = (await stat(SOURCE)).size
const srcHash = sha(readFileSync(SOURCE))

const dropped = []
for (const material of doc.getRoot().listMaterials()) {
  if (material.getNormalTexture()) { material.setNormalTexture(null); dropped.push('normal') }
  if (material.getEmissiveTexture()) { material.setEmissiveTexture(null); dropped.push('emissive') }
  material.setEmissiveFactor([0, 0, 0])
  if (material.getMetallicRoughnessTexture()) {
    material.setMetallicRoughnessTexture(null); dropped.push('metallicRoughness')
  }
  // Costume fur: dielectric and uniformly rough.
  material.setMetallicFactor(0)
  material.setRoughnessFactor(0.92)
}

let resized = null
for (const texture of doc.getRoot().listTextures()) {
  const used = texture.listParents().some((p) => p.propertyType === 'Material')
  if (!used) { texture.dispose(); continue }
  const out = downscale(Buffer.from(texture.getImage()), texture.getMimeType(), BASECOLOR_PX)
  if (out) {
    resized = { from: texture.getImage().byteLength, to: out.bytes.byteLength }
    texture.setImage(out.bytes).setMimeType(out.mime)
  }
}
// Textures orphaned by the material edits above still carry their pixels in the buffer.
doc.getRoot().listTextures().forEach((t) => {
  if (!t.listParents().some((p) => p.propertyType === 'Material')) t.dispose()
})

await mkdir(OUT_DIR, { recursive: true })
const out = await io.writeBinary(doc)
await writeFile(OUT, out)

const tris = doc.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0)

const record = {
  source: 'samples/hokiebird-npc/model.glb',
  source_sha256: srcHash,
  source_bytes: srcBytes,
  asset_sha256: sha(Buffer.from(out)),
  bytes: out.byteLength,
  triangles: Math.round(tris),
  textures_dropped: [...new Set(dropped)],
  basecolor_resized_to_px: resized ? BASECOLOR_PX : null,
  note: 'Avatar-scale copy. Geometry is unmodified; only textures were reduced.',
}
await writeFile(`${OUT_DIR}/optimization.json`, JSON.stringify(record, null, 2) + '\n')

console.log(`source  ${(srcBytes / 1e6).toFixed(2)} MB`)
console.log(`dropped ${record.textures_dropped.join(', ') || '(none)'}`)
if (resized) console.log(`basecolor ${(resized.from / 1e6).toFixed(2)} -> ${(resized.to / 1e6).toFixed(2)} MB @ ${BASECOLOR_PX}px`)
console.log(`wrote   ${OUT}  ${(out.byteLength / 1e6).toFixed(2)} MB, ${record.triangles} triangles`)
console.log(`        ${(100 * out.byteLength / srcBytes).toFixed(0)}% of source`)
