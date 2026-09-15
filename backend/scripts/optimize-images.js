import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const srcDir = path.join(process.cwd(), '../public/image-search');
const outDir = path.join(process.cwd(), '../public/images/optimized');
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter(f=> /\.(jpe?g|png|webp|gif)$/i.test(f));
console.log(`[optimize] ${files.length} files from ${srcDir}`);

for (const f of files) {
  const src = path.join(srcDir, f);
  const base = f.replace(/\.[^.]+$/, '');
  const buf = fs.readFileSync(src);
  const meta = await sharp(buf).metadata();
  console.log(` - ${f} ${meta.width}x${meta.height} ${Math.round(buf.length/1024)}KB →`);
  for (const [w, q] of [[320,78],[640,80],[960,82],[1280,84]]) {
    const out = await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: q }).toBuffer();
    fs.writeFileSync(path.join(outDir, `${base}-${w}.webp`), out);
    console.log(`   ${w}w WebP ${Math.round(out.length/1024)}KB q${q}`);
  }
  // OG 1200x630
  const og = await sharp(buf).resize({ width: 1200, height: 630, fit: 'cover' }).webp({ quality: 84 }).toBuffer();
  fs.writeFileSync(path.join(outDir, `${base}-og.webp`), og);
  console.log(`   og 1200x630 ${Math.round(og.length/1024)}KB`);
}
console.log(`[optimize] done → ${outDir}`);
