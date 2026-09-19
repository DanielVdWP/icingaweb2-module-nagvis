const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const variant = process.argv[2];
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errs = [];
        page.on('pageerror', error => errs.push(error.message));
        const url = 'http://127.0.0.1/icingaweb2/nagvis/show/map?map=demo-overview&showMenu=1&keep=issue84';
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const frame = page.frameLocator('#nagvis-iframe');
        await frame.locator('body').waitFor();
        await page.waitForTimeout(900);
        const mapLinks = await frame.locator('a').evaluateAll(links => links.map(a => ({
            text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 95),
            href: a.getAttribute('href'),
            target: a.getAttribute('target'),
            html: a.outerHTML.slice(0, 350)
        })).filter(a => /Demo:|Map|Hamburg|Germany|Open/i.test(a.text + ' ' + a.href)).slice(0, 45));
        const report = { variant, initialParent: page.url(), links: mapLinks, errors: errs };
        const prefix = path.join(process.env.RUNNER_TEMP || process.cwd(), 'issue84-click-' + variant);
        console.log('REAL NAGVIS UI MAP LINKS ' + JSON.stringify(mapLinks, null, 2));

        // Select a link from NagVis's own menu, without programmatic iframe navigation.
        const hamburg = frame.getByText('Demo: 1 Datacenter Hamburg', { exact: true }).first();
        const targetCount = await hamburg.count();
        report.mapLinkCount = targetCount;
        if (targetCount) {
            const target = hamburg;
            const isVisible = await target.isVisible();
            report.mapLinkInitiallyVisible = isVisible;
            if (! isVisible) {
                const open = frame.getByText('Open', { exact: true }).first();
                await open.hover().catch(() => null);
                await page.waitForTimeout(300);
            }
            await target.click({ timeout: 12000 });
            await page.waitForTimeout(2000);
            report.afterParentUrl = page.url();
            const iframeElement = page.locator('#nagvis-iframe');
            report.afterIframeUrl = await iframeElement.count()
                ? await iframeElement.evaluate(el => el.contentWindow.location.href).catch(() => null) : null;
            report.afterTitle = await page.title();
            report.afterMenuLabels = await page.locator('a').evaluateAll(els => els.map(e=>e.textContent.trim()).filter(t => t.includes('NagVis Menu')));
        }
        report.errors = errs;
        await page.screenshot({ path: prefix + '.png', fullPage: true });
        fs.writeFileSync(prefix + '.json', JSON.stringify(report, null, 2));
        console.log('REAL NAGVIS UI CLICK RESULT ' + JSON.stringify(report, null, 2));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
