const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const variant = process.argv[2];
    if (!['baseline','pr84'].includes(variant)) throw Error('Expected baseline or pr84');
    const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
    const output = path.join(process.env.RUNNER_TEMP || process.cwd(),'issue84-mapicon-'+variant);
    const report = {variant, navigations:[], errors:[]};
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        page.on('framenavigated',f=>report.navigations.push({top:f===page.mainFrame(),url:f.url()}));
        page.on('pageerror',e=>report.errors.push(e.message));
        const start = 'http://127.0.0.1/icingaweb2/nagvis/show/map?map=demo-overview&showMenu=1&keep=mapicon';
        await page.goto(start,{waitUntil:'domcontentloaded'});
        const frame = page.frameLocator('#nagvis-iframe');
        await frame.locator('body').waitFor();
        await page.waitForTimeout(900);
        const initialText = await frame.locator('body').innerText();
        if (/You are not permitted to access|not authenticated/i.test(initialText))
            throw Error('NagVis demo overview access denied');
        const anchor = frame.locator('a[href*="/icingaweb2/nagvis/show/map?map=demo-ham-racks"]').first();
        report.realMapLinkCount = await anchor.count();
        report.mapLinkSamples = await frame.locator('a').evaluateAll(nodes=>nodes.map(a=>({
            href:a.getAttribute('href'),target:a.getAttribute('target'),
            txt:a.textContent.trim().slice(0,35)
        })).filter(x=>/demo-ham-racks|icingaweb2\/nagvis/.test(x.href||'')).slice(0,20));
        if (report.realMapLinkCount !== 1)
            throw Error('NagVis map icon is not linked via the documented Icinga Web mapurl');
        report.realMapLink = await anchor.evaluate(el=>el.outerHTML.slice(0,850));
        await anchor.click({timeout:12000});
        await page.waitForTimeout(1500);
        report.after = {
            parentUrl:page.url(),
            iframeUrl:await page.locator('#nagvis-iframe').evaluate(el=>el.contentWindow.location.href).catch(()=>null),
            menuLabels:await page.locator('a').evaluateAll(els=>els.map(el=>el.textContent.trim()).filter(t=>t.includes('NagVis Menu'))),
            childText:(await frame.locator('body').innerText()).slice(0,240)
        };
        const parent = new URL(report.after.parentUrl);
        const child = new URL(report.after.iframeUrl);
        report.menuLost = parent.searchParams.get('map')==='demo-ham-racks'
            && !parent.searchParams.has('showMenu')
            && child.searchParams.get('show')==='demo-ham-racks'
            && child.searchParams.get('header_menu')==='0'
            && report.after.menuLabels.includes('Show NagVis Menu');
        if (!report.menuLost) throw Error('Expected original menu-loss through configured mapurl was NOT reproduced');
        if (report.errors.length) throw Error('Browser errors: '+JSON.stringify(report.errors));
    } catch(e) {
        report.failure = e.message;
        throw e;
    } finally {
        fs.writeFileSync(output+'.json',JSON.stringify(report,null,2));
        console.log('DOCUMENTED NAGVIS MAP OBJECT LINK REPRO '+JSON.stringify(report,null,2));
        await browser.close();
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
