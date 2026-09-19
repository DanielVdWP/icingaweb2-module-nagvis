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
        const nagvisPageText = await frame.locator('body').innerText();
        const authEvidence = {
            parentUserDisplay: (await page.locator('body').innerText()).slice(0,250),
            nagvisText: nagvisPageText.slice(0,1100),
            cookieMeta: (await page.context().cookies()).map(({ name, domain, path, sameSite }) => ({name, domain, path, sameSite})),
            iframeLocation: await page.locator('#nagvis-iframe').evaluate(el => el.contentWindow.location.href),
        };
        console.log('AUTH EVIDENCE ' + JSON.stringify(authEvidence));
        if (/You are not permitted to access this page|not authenticated|Error \(/i.test(nagvisPageText)) {
            await page.screenshot({ path: path.join(process.env.RUNNER_TEMP || process.cwd(), 'issue84-unauthorized-' + variant + '.png'), fullPage: true });
            throw new Error('NagVis authorization denied; cannot test real map menu');
        }
        const openMenu = frame.getByText('Open', { exact: true }).first();
        await openMenu.hover();
        await openMenu.click();
        await page.waitForTimeout(500);
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
        report.openMenuHtml = await frame.locator('body').evaluate(el => {
            const s = el.innerHTML, i = s.indexOf('Demo: 1');
            return i < 0 ? s.slice(0,2000) : s.slice(Math.max(0,i-650),i+650);
        });
        report.demoHamburgHtml = await frame.locator('body').evaluate(el => {
            const s = el.innerHTML, i = s.indexOf('Demo: 1 Datacenter Hamburg');
            return i < 0 ? 'not found in DOM' : s.slice(Math.max(0,i-650),i+650);
        });
        report.mapSelectOptions = await frame.locator('select option').evaluateAll(nodes => nodes
            .filter(el => /Hamburg|Germany/i.test(el.textContent))
            .map(el => ({ html: el.outerHTML, select: el.closest('select')?.outerHTML.slice(0,850) })));

        if (! targetCount && report.mapSelectOptions.some(el => /Hamburg/.test(el.html))) {
            const select = frame.locator('select').filter({ hasText: 'Demo: 1 Datacenter Hamburg' }).first();
            await select.selectOption({ label: 'Demo: 1 Datacenter Hamburg' });
            await page.waitForTimeout(2000);
            report.afterParentUrl = page.url();
            const iframeElement = page.locator('#nagvis-iframe');
            report.afterIframeUrl = await iframeElement.count()
                ? await iframeElement.evaluate(el => el.contentWindow.location.href).catch(() => null) : null;
            report.afterTitle = await page.title();
            report.afterMenuLabels = await page.locator('a').evaluateAll(els => els.map(e=>e.textContent.trim()).filter(t => t.includes('NagVis Menu')));
        } else if (targetCount) {
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
