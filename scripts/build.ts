import { mkdir, rm, cp, rename, readFile, writeFile } from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const publicDir = path.join(projectRoot, 'public');
const serverEntry = path.join(projectRoot, 'src', 'server.ts');
const clientEntry = path.join(publicDir, 'script.js');
const stylesEntry = path.join(publicDir, 'styles.css');

async function cleanDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function bundleServer() {
  const result = await Bun.build({
    entrypoints: [serverEntry],
    outdir: distDir,
    target: 'bun',
    minify: true,
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message);
    }

    throw new Error('Bundle falhou.');
  }
}

async function bundleClient() {
  const result = await Bun.build({
    entrypoints: [clientEntry],
    outdir: distDir,
    target: 'browser',
    minify: true,
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message);
    }

    throw new Error('Bundle client falhou.');
  }

  const entryOutput = result.outputs.find((output) => output.kind === 'entry-point');
  if (entryOutput) {
    const desiredPath = path.join(distDir, 'script.js');
    if (entryOutput.path !== desiredPath) {
      await rename(entryOutput.path, desiredPath);
    }
  }
}

async function bundleStyles() {
  const result = await Bun.build({
    entrypoints: [stylesEntry],
    outdir: distDir,
    target: 'browser',
    minify: true,
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message);
    }

    throw new Error('Bundle styles falhou.');
  }

  const entryOutput = result.outputs.find((output) => output.kind === 'entry-point');
  if (entryOutput) {
    const desiredPath = path.join(distDir, 'styles.css');
    if (entryOutput.path !== desiredPath) {
      await rename(entryOutput.path, desiredPath);
    }
  }
}

async function copyPublicAssets() {
  await cp(publicDir, distDir, { recursive: true, force: true });
}

async function minifyIndexHtml() {
  const indexPath = path.join(distDir, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const { minify } = await import('html-minifier-terser');
  const minified = await minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    minifyCSS: true,
    minifyJS: true,
    keepClosingSlash: true,
  });

  await writeFile(indexPath, minified, 'utf8');
}

async function run() {
  await cleanDist();
  await copyPublicAssets();
  await bundleServer();
  await bundleClient();
  await bundleStyles();
  await minifyIndexHtml();
}

run()
  .then(() => {
    console.log('Build concluído em', distDir);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
