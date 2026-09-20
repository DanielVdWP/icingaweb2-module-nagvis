const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const variant = process.argv[2];
    if (!['baseline', 'pr84'].includes(variant)) throw Error('Expected baseline or pr84');
    const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
    const output = path.join(process.env.RUNNER_TEMP || process.cwd(), 'issue84-sidebar-' + variant);
    const report = {variant, events:[], pageErrors:[]};
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        page.on('pageerror', e => report.pageErrors.push(e.message));
        page.on('framenavigated', f => report.events.push({
            top:f === page.mainFrame(),url:f.url()
        }));
        const base = 'http://127.0.0.1/icingaweb2/nagvis/show/map';
        await page.goto(base + '?map=demo-overview&showMenu=1&keep=sidebar',
            {waitUntil:'domcontentloaded'});
        const frame = page.frameLocator('#nagvis-iframe');
        await frame.locator('body').waitFor();
        await page.waitForTimeout(750);
        let body = await frame.locator('body').innerText();
        if (!body.includes('Demo: 1 Datacenter Hamburg')
            || /You are not permitted to access/i.test(body)) {
            throw Error('The actual NagVis map/sidebar is not accessible: ' + body.slice(0,240));
        }
        const tree = frame.locator('#sb-maps');
        if (await tree.count() !== 1) throw Error('Actual NagVis left sidebar Maps tree not found');
        report.sidebarContainer = await tree.evaluate(el => {
            let n = el;
            return [0,1,2,3].map(() => {
                let info = n?.outerHTML?.slice(0,1400);
                n=n?.parentElement;
                return info;
            });
        });
        // Select a link physically contained by the NagVis side menu, not Open ->.
        const link = frame.locator('#sb-maps').locator('xpath=..').locator('a[href*="show=demo-ham-racks"]').first();
        report.sidebarLinkCount = await link.count();
        if (report.sidebarLinkCount !== 1) {
            throw Error('Could not identify Hamburg link inside the real NagVis left sidebar');
        }
        report.sidebarAnchor = await link.evaluate(el=>el.outerHTML);
        await link.click({timeout:12000});
        await page.waitForTimeout(1500);
        report.afterSidebar = {
            parentUrl:page.url(),
            iframeUrl:await page.locator('#nagvis-iframe').evaluate(el=>el.contentWindow.location.href),
            parentLabels:await page.locator('a').evaluateAll(els=>els.map(e=>e.textContent.trim()).filter(t=>t.includes('NagVis Menu'))),
            childBody:(await frame.locator('body').innerText()).slice(0,200)
        };
        const parent = new URL(report.afterSidebar.parentUrl);
        const child = new URL(report.afterSidebar.iframeUrl);
        if (parent.searchParams.get('map') !== 'demo-ham-racks'
            || parent.searchParams.get('showMenu') !== '1'
            || parent.searchParams.get('keep') !== 'sidebar'
            || child.searchParams.get('show') !== 'demo-ham-racks'
            || child.searchParams.get('header_menu') !== '1'
            || !report.afterSidebar.parentLabels.includes('Hide NagVis Menu')) {
            throw Error('Sidebar selection lost map or NagVis menu state');
        }
        // Exercise the Icinga Web toggle on the newly selected map.
        const hide = page.locator('a').filter({hasText:'Hide NagVis Menu'}).first();
        report.hideLink = await hide.evaluate(el => el.outerHTML);
        await hide.evaluate(el => el.click());
        await page.waitForTimeout(1400);
        report.afterHide = {
            parentUrl:page.url(),
            iframeUrl:await page.locator('#nagvis-iframe').evaluate(el=>el.contentWindow.location.href),
            parentLabels:await page.locator('a').evaluateAll(els=>els.map(e=>e.textContent.trim()).filter(t=>t.includes('NagVis Menu'))),
            childBody:(await frame.locator('body').innerText()).slice(0,160)
        };
        const after = new URL(report.afterHide.parentUrl);
        const childAfter = new URL(report.afterHide.iframeUrl);
        if (after.searchParams.get('map') !== 'demo-ham-racks'
            || after.searchParams.has('showMenu')
            || childAfter.searchParams.get('show') !== 'demo-ham-racks'
            || childAfter.searchParams.get('header_menu') !== '0'
            || !report.afterHide.parentLabels.includes('Show NagVis Menu')) {
            throw Error('Hiding menu switched map or left inconsistent showMenu/header_menu state');
        }
        if (report.pageErrors.length) throw Error('Browser runtime errors: '+JSON.stringify(report.pageErrors));
    } catch (e) {
        report.failure = e.message;
        throw e;
    } finally {
        fs.writeFileSync(output+'.json',JSON.stringify(report,null,2));
        console.log('NAGVIS REAL LEFT SIDEBAR / TOGGLE '+JSON.stringify(report,null,2));
        await browser.close();
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
