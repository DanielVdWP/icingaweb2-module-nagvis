const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const scenario = process.argv[2];
    if (! ['correct', 'misrouted'].includes(scenario)) {
        throw new Error('Pass correct or misrouted as scenario');
    }

    const out = process.env.RUNNER_TEMP || process.cwd();
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));

    const target = 'http://127.0.0.1/icingaweb2/nagvis/show/map?map=demo-overview';
    const parentResponse = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('iframe#nagvis-iframe').waitFor({ state: 'attached', timeout: 20000 });
    const handle = await page.locator('iframe#nagvis-iframe').elementHandle();
    const frame = await handle.contentFrame();
    if (! frame) {
        throw new Error('Real module iframe was not initialized');
    }
    await frame.waitForLoadState('domcontentloaded', { timeout: 20000 });
    await page.waitForTimeout(1500);

    const parentIcinga = await page.locator('[data-icinga-base-url]').count();
    const childIcinga = await frame.locator('[data-icinga-base-url]').count();
    const iframeUrl = frame.url();
    const iframeTitle = await frame.title();
    const result = {
        scenario,
        versions: { icingaweb2: '2.12.1-1', nagvis: '1.9.40-1', module: '1.1.1-4' },
        parentStatus: parentResponse.status(),
        parentUrl: page.url(),
        iframeUrl,
        iframeTitle,
        parentIcinga,
        childIcinga,
        iframeSource: await handle.getAttribute('src'),
        browserPageErrors: failures,
        screenshot: path.join(out, scenario + '.png'),
    };
    await page.screenshot({ path: result.screenshot, fullPage: true });
    fs.writeFileSync(path.join(out, scenario + '.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));

    if (parentResponse.status() !== 200 || parentIcinga !== 1) {
        throw new Error('The parent response must be a real, authenticated Icinga Web page');
    }
    if (scenario === 'correct' && ! (
        iframeUrl.includes('/nagvis/frontend/nagvis-js/index.php')
        && iframeTitle.includes('NagVis')
        && childIcinga === 0
    )) {
        throw new Error('Correct routing must load real NagVis and no nested Icinga Web');
    }
    if (scenario === 'misrouted' && ! (
        iframeUrl.includes('/icingaweb2/dashboard')
        && childIcinga === 1
    )) {
        throw new Error('Misrouted NagVis iframe must show real nested Icinga Web');
    }
    await browser.close();
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
