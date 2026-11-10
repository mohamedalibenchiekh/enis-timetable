const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'branding', 'icon.svg');
const smallSource = path.join(root, 'branding', 'icon-small.svg');
const desktop = path.join(root, 'apps', 'desktop', 'build');
const web = path.join(root, 'apps', 'web', 'app');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const linuxSizes = [16, 24, 32, 48, 64, 128, 256, 512];

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

async function render(svg, size) {
  return sharp(svg, { density: 288 })
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

function ico(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map(({ png }) => png)]);
}

function icns(pngs) {
  // In modern ICNS files, icp6 is a 64x64 PNG slot. The legacy 48x48 image
  // uses ih32 + h8mk, so do not put a 48x48 PNG under icp6.
  const types = new Map([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]);
  const chunks = pngs.map(({ size, png }) => {
    const chunk = Buffer.alloc(8);
    chunk.write(types.get(size), 0, 'ascii');
    chunk.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([chunk, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

function bmp24(raw, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelsSize = rowSize * height;
  const bmp = Buffer.alloc(54 + pixelsSize);
  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(pixelsSize, 34);
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 3;
      const targetOffset = 54 + y * rowSize + x * 3;
      bmp[targetOffset] = raw[sourceOffset + 2];
      bmp[targetOffset + 1] = raw[sourceOffset + 1];
      bmp[targetOffset + 2] = raw[sourceOffset];
    }
  }
  return bmp;
}

const SIDEBAR_GLYPHS = {
  D: ['1110', '1001', '1001', '1001', '1001', '1001', '1110'],
  E: ['1111', '1000', '1000', '1110', '1000', '1000', '1111'],
  I: ['1111', '0110', '0110', '0110', '0110', '0110', '1111'],
  L: ['1000', '1000', '1000', '1000', '1000', '1000', '1111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['1001', '1101', '1011', '1001', '1001', '1001', '1001'],
  O: ['0110', '1001', '1001', '1001', '1001', '1001', '0110'],
  P: ['1110', '1001', '1001', '1110', '1000', '1000', '1000'],
  S: ['0111', '1000', '1000', '0110', '0001', '0001', '1110'],
  T: ['1111', '0110', '0110', '0110', '0110', '0110', '0110'],
  U: ['1001', '1001', '1001', '1001', '1001', '1001', '0110'],
};

function sidebarPixelText(text, y, scale, color) {
  const advance = (character) => character === ' ' ? 3 : 6;
  const width = [...text].reduce((total, character) => total + advance(character), 0) - 1;
  let cursor = 0;
  const pixels = [];
  for (const character of text) {
    if (character !== ' ') {
      const glyph = SIDEBAR_GLYPHS[character.toUpperCase()];
      if (!glyph) throw new Error(`Missing sidebar glyph: ${character}`);
      glyph.forEach((row, rowIndex) => {
        [...row].forEach((pixel, columnIndex) => {
          if (pixel === '1') {
            pixels.push(`<rect x="${(cursor + columnIndex) * scale}" y="${rowIndex * scale}" width="${scale}" height="${scale}"/>`);
          }
        });
      });
    }
    cursor += advance(character);
  }
  const left = (164 - width * scale) / 2;
  return `<g transform="translate(${left} ${y}) scale(1)" fill="${color}" shape-rendering="crispEdges">${pixels.join('')}</g>`;
}

function sidebarSvg(variant) {
  const uninstaller = variant === 'uninstallerSidebar';
  const markX = uninstaller ? 36 : 26;
  // The artwork's visible outer tile spans x=96..928 in its 1024 viewBox.
  // At 0.11 scale these positions keep its bounds inside x=36..139 of 164 px.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
    <rect width="164" height="314" fill="#1D2733"/>
    <path d="M0 0h164v10H0z" fill="#C2D69B"/>
    <g transform="translate(${markX} 48) scale(.11)">${fs.readFileSync(source, 'utf8').replace(/<\/?svg[^>]*>/g, '')}</g>
    ${sidebarPixelText('EMPLOIS DU TEMPS', 180, 1.5, '#fff')}
    ${sidebarPixelText('ENISo', 197, 2, '#B8CCE4')}
    <rect x="18" y="232" width="128" height="2" fill="#C2D69B"/>
  </svg>`);
}

async function writePng(svg, size, destination) {
  await fs.promises.writeFile(destination, await render(svg, size));
}

async function main() {
  ensureDirectory(desktop);
  ensureDirectory(path.join(desktop, 'icons'));
  const fullSvg = fs.readFileSync(source);
  const compactSvg = fs.readFileSync(smallSource);
  await writePng(fullSvg, 1024, path.join(desktop, 'icon.png'));
  await writePng(compactSvg, 32, path.join(desktop, 'icon-small.png'));

  const icoPngs = [];
  for (const size of sizes) {
    const png = await render(size <= 32 ? compactSvg : fullSvg, size);
    icoPngs.push({ size, png });
    if (linuxSizes.includes(size)) {
      await fs.promises.writeFile(path.join(desktop, 'icons', `${size}x${size}.png`), png);
    }
  }
  for (const size of [512, 1024]) {
    const png = await render(fullSvg, size);
    if (size === 512) await fs.promises.writeFile(path.join(desktop, 'icons', '512x512.png'), png);
    if (size === 1024) icoPngs.push({ size, png });
  }
  await fs.promises.writeFile(path.join(desktop, 'icon.ico'), ico(icoPngs.filter(({ size }) => sizes.includes(size))));
  const macPngs = [16, 32, 64, 128, 256, 512, 1024].map((size) => ({
    size,
    png: size <= 32 ? null : undefined,
  }));
  for (const item of macPngs) item.png = await render(item.size <= 32 ? compactSvg : fullSvg, item.size);
  await fs.promises.writeFile(path.join(desktop, 'icon.icns'), icns(macPngs));

  await writePng(fullSvg, 1024, path.join(web, 'icon.png'));
  await fs.promises.writeFile(path.join(web, 'favicon.ico'), ico([
    { size: 16, png: await render(compactSvg, 16) },
    { size: 32, png: await render(compactSvg, 32) },
  ]));

  for (const name of ['installerSidebar', 'uninstallerSidebar']) {
    const rendered = await sharp(sidebarSvg(name), { density: 288 }).resize(164, 314).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    await fs.promises.writeFile(path.join(desktop, `${name}.bmp`), bmp24(rendered.data, 164, 314));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
