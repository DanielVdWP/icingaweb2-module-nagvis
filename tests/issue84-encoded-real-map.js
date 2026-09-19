const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const variant = process.argv[2];
    if (! ['baseline', 'pr84'].includes(variant)) throw Error('Invalid variant');
    const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
    try {
        const page = await browser.newPage({viewport: {width: 1440, height: 900}});
        const navigations = [];
        const errors = [];
        page.on('framenavigated', frame => {
            if (frame === page.mainFrame()) navigations.push(frame.url());
        });
        page.on('pageerror', e => errors.push(e.message));
        const start = 'http://127.0.0.1/icingaweb2/nagvis/show/map?map=demo-ham-racks&showMenu=1&keep=encoded';
        const response = await page.goto(start, {waitUntil: 'domcontentloaded'});
        await page.frameLocator('#nagvis-iframe').locator('body').waitFor();
        await page.waitForTimeout(800);
        const initialText = await page.frameLocator('#nagvis-iframe').locator('body').innerText();
        if (response.status() !== 200 || ! initialText.includes('Datacenter Hamburg')
            || /You are not permitted to access|Error/i.test(initialText.slice(0, 170))) {
            throw Error('Real NagVis map was not accessible before encoded navigation: ' + initialText.slice(0, 240));
        }
        const frame = page.frame({url:/\/nagvis\/frontend\/nagvis-js\/index\.php/});
        if (! frame) throw Error('Actual NagVis frame was not found');
        const encoded = 'http://127.0.0.1/nagvis/frontend/nagvis-js/index.php'
            + '?mod=Map&act=view&show=demo%2Dham%2Dracks&header_menu=1';
        const childResponse = await frame.goto(encoded, {waitUntil: 'domcontentloaded'});
        await page.waitForTimeout(1700);
        const afterUrl = page.url();
        const childUrl = await page.locator('#nagvis-iframe').evaluate(el => el.contentWindow.location.href);
        const childText = await page.frameLocator('#nagvis-iframe').locator('body').innerText();
        const menuLabels = await page.locator('a').evaluateAll(els => els
            .map(el => el.textContent.trim()).filter(t => t.includes('NagVis Menu')));
        const result = {
            variant, initialUrl:start, encodedIframeRequest:encoded,
            initialMapRendered:true, iframeResponseStatus:childResponse.status(),
            afterParentUrl:afterUrl, afterIframeUrl:childUrl,
            afterParentMap:new URL(afterUrl).searchParams.get('map'),
            afterParentShowMenu:new URL(afterUrl).searchParams.get('showMenu'),
            parentNavigations:navigations, menuLabels, 
            afterChildMapRendered:childText.includes('Datacenter Hamburg'),
            afterChildError:childText.slice(0, 450), errors
        };
        const prefix = path.join(process.env.RUNNER_TEMP || process.cwd(), 'issue84-encoded-' + variant);
        await page.screenshot({path:prefix+'.png',fullPage:true});
        fs.writeFileSync(prefix+'.json',JSON.stringify(result,null,2));
        console.log('ENCODED REAL MAP TEST '+JSON.stringify(result,null,2));
        if (variant==='pr84' && (
            result.afterParentMap !== 'demo-ham-racks'
            || result.afterParentShowMenu !== '1'
            || result.parentNavigations.length !== 1
            || ! result.afterChildMapRendered
            || ! result.menuLabels.includes('Hide NagVis Menu')
            || result.errors.length
        )) throw Error('PR84 does not preserve real decoded map and menu state');
    } finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode=1; });
