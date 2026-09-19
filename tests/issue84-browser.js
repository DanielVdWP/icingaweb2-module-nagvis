const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const variant = process.argv[2];
    if (! ['baseline', 'pr84'].includes(variant)) throw new Error('Expected baseline or pr84');
    const outputDir = process.env.RUNNER_TEMP || process.cwd();
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        const moduleResponses = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', r => {
            if (r.url().includes('/nagvis') && r.url().endsWith('/module.js')) {
                moduleResponses.push({ url: r.url(), status: r.status() });
            }
        });
        const start = 'http://127.0.0.1/icingaweb2/nagvis/show/map?map=demo-overview&showMenu=1&keep=issue84';
        const response = await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('iframe#nagvis-iframe').waitFor({ state: 'attached', timeout: 20000 });
        const iframe = page.frameLocator('#nagvis-iframe');
        await iframe.locator('body').waitFor({ state: 'attached', timeout: 20000 });
        await page.waitForTimeout(1000);

        const initial = {
            parentStatus: response.status(),
            parentUrl: page.url(),
            iframeUrl: await page.locator('#nagvis-iframe').evaluate(el => el.contentWindow.location.href),
            iframeTitle: await iframe.locator('title').textContent().catch(() => ''),
            modulePresent: await page.evaluate(() => typeof Icinga !== 'undefined' && !!Icinga.availableModules.nagvis),
            implementation: await page.evaluate(() => Icinga.availableModules.nagvis.prototype.setCurrentMap.toString()),
            menuLabels: await page.locator('a, button').evaluateAll(nodes => nodes
                .map(el => ({ label: el.textContent.trim(), href: el.getAttribute('href') }))
                .filter(el => /NagVis Menu/i.test(el.label))),
            nagvisBodyPreview: await iframe.locator('body').innerText().then(t => t.slice(0, 700)),

            moduleResponses,
            menuControl: await page.evaluate(() => document.body.textContent.includes('Hide NagVis Menu')),
        };
        const frame = page.frame({ url: /\/nagvis\/frontend\/nagvis-js\/index\.php/ });
        if (! frame) throw new Error('Actual NagVis iframe was not loaded');
        if (response.status() !== 200 || ! initial.iframeTitle.includes('NagVis')) {
            throw new Error('Baseline real stack not operational: ' + JSON.stringify(initial));
        }

        // Navigate the real standalone NagVis iframe to a second REAL map.
        // The iframe uses actual NagVis PHP, not a mocked HTML response.
        const mapUrl = 'http://127.0.0.1/nagvis/frontend/nagvis-js/index.php'
            + '?mod=Map&act=view&show=issue84-second&header_menu=0';
        const mapResponse = await frame.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1700);

        const after = {
            mapStatus: mapResponse?.status(),
            parentUrl: page.url(),
            parentMap: new URL(page.url()).searchParams.get('map'),
            parentShowMenu: new URL(page.url()).searchParams.get('showMenu'),
            parentKeep: new URL(page.url()).searchParams.get('keep'),
            childUrl: page.frames().find(f => f.parentFrame() === page.mainFrame() && f.name() === frame.name())?.url(),
            iframeUrl: await page.locator('#nagvis-iframe').evaluate(el => el.contentWindow.location.href),
            iframeTitle: await page.frameLocator('#nagvis-iframe').locator('title').textContent().catch(() => ''),
            menuControl: await page.evaluate(() => document.body.textContent.includes('Hide NagVis Menu')),
        };

        const result = { variant, initial, after, errors };
        const prefix = path.join(outputDir, 'issue84-' + variant);
        await page.screenshot({ path: prefix + '.png', fullPage: true });
        fs.writeFileSync(prefix + '.json', JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));

        if (! initial.modulePresent) throw new Error('NagVis module JavaScript not registered');
        if (! initial.menuControl) throw new Error('Show NagVis Menu was not enabled on initial page');
        if (variant === 'baseline') {
            if (! initial.implementation.includes('removeUrlParams')) {
                throw new Error('Baseline did not load upstream main implementation');
            }
        } else {
            if (! initial.implementation.includes('url.searchParams.set')) {
                throw new Error('PR test did not load PR 84 implementation');
            }
            if (after.parentMap !== 'issue84-second' ||
                after.parentShowMenu !== '1' ||
                after.parentKeep !== 'issue84' ||
                ! after.iframeUrl.includes('show=issue84-second') ||
                ! after.iframeUrl.includes('header_menu=1') ||
                ! after.menuControl) {
                throw new Error('PR #84 failed to synchronize map while preserving NagVis menu');
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
