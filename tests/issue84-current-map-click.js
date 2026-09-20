const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const variant = process.argv[2];
    if (!['baseline','pr84'].includes(variant)) throw Error('Expected baseline or pr84');
    const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    const output = path.join(process.env.RUNNER_TEMP || process.cwd(),'issue84-samemap-'+variant);
    const report = {variant, topNavigations:[], errors:[]};
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        page.on('framenavigated', f => {
            if(f===page.mainFrame()) report.topNavigations.push(f.url());
        });
        page.on('pageerror', e=>report.errors.push(e.message));
        const start='http://127.0.0.1/icingaweb2/nagvis/show/map?map=demo-overview&showMenu=1&keep=samemap';
        await page.goto(start,{waitUntil:'domcontentloaded'});
        const frame=page.frameLocator('#nagvis-iframe');
        await frame.locator('body').waitFor();
        await page.waitForTimeout(750);
        report.initial={
            parentUrl:page.url(),
            iframeUrl:await page.locator('#nagvis-iframe').evaluate(el=>el.contentWindow.location.href),
            menuVisible:await frame.getByText('Open',{exact:true}).count()===1,
            menuLabel:await page.locator('a').evaluateAll(es=>es.map(e=>e.textContent.trim()).filter(x=>x.includes('NagVis Menu')))
        };
        if(!report.initial.menuVisible || !report.initial.menuLabel.includes('Hide NagVis Menu'))
            throw Error('Initial NagVis menu is not actually displayed');
        await frame.getByText('Open',{exact:true}).first().click();
        const sameMap=frame.locator('a[href*="mod=Map"][href*="show=demo-overview"]')
            .filter({hasText:'Demo Overview'}).first();
        report.sameMapCount=await sameMap.count();
        if(report.sameMapCount!==1)throw Error('Real NagVis Open -> current map link missing');
        report.sameMapAnchor=await sameMap.evaluate(el=>el.outerHTML.slice(0,600));
        if(/header_menu=1/.test(report.sameMapAnchor))
            throw Error('Menu link unexpectedly propagates header_menu=1');
        const initialFrame = page.frame({ url: /\/nagvis\/frontend\/nagvis-js\/index\.php/ });
        const reloadingFrame = page.waitForEvent('framenavigated', {
            predicate: f => f === initialFrame
                && new URL(f.url()).searchParams.get('show') === 'demo-overview'
                && !new URL(f.url()).searchParams.has('header_menu'),
            timeout: 12000
        });
        await sameMap.click();
        // Wait for the real first navigation before inspecting the iframe:
        // otherwise the initial header_menu=1 page causes a false positive.
        await reloadingFrame;
        if (variant === 'pr84') {
            await page.waitForFunction(() => {
                const child = document.querySelector('#nagvis-iframe');
                if (!child || !child.contentDocument
                    || child.contentDocument.readyState !== 'complete') return false;
                const url = new URL(child.contentWindow.location.href);
                return url.searchParams.get('header_menu') === '1'
                    && child.contentDocument.body.innerText.includes('Open');
            }, null, {timeout: 12000});
            await page.waitForTimeout(300);
        } else {
            await page.waitForTimeout(1250);
        }
        report.after={
            parentUrl:page.url(),
            iframeUrl:await page.locator('#nagvis-iframe').evaluate(el=>el.contentWindow.location.href),
            openMenuCount:await frame.getByText('Open',{exact:true}).count(),
            menuLabel:await page.locator('a').evaluateAll(es=>es.map(e=>e.textContent.trim()).filter(x=>x.includes('NagVis Menu'))),
            mapBody:(await frame.locator('body').innerText()).slice(0,180)
        };
        const parent=new URL(report.after.parentUrl), child=new URL(report.after.iframeUrl);
        report.parentPreserved = parent.searchParams.get('map') === 'demo-overview'
            && parent.searchParams.get('showMenu') === '1'
            && parent.searchParams.get('keep') === 'samemap'
            && child.searchParams.get('show') === 'demo-overview'
            && report.after.menuLabel.includes('Hide NagVis Menu')
            && report.topNavigations.length === 1;
        report.originalInconsistencyReproduced = report.parentPreserved
            && !child.searchParams.has('header_menu')
            && report.after.openMenuCount === 0;
        report.fixedMenuState = report.parentPreserved
            && child.searchParams.get('header_menu') === '1'
            && report.after.openMenuCount === 1
            && report.after.mapBody.includes('Demo: 1 Datacenter Hamburg');
        if (variant === 'baseline' && !report.originalInconsistencyReproduced)
            throw Error('Upstream main did not reproduce original menu inconsistency');
        if (variant === 'pr84' && !report.fixedMenuState)
            throw Error('PR84 did not restore real NagVis menu on same-map navigation');

        if (variant === 'pr84') {
            // Follow the real Icinga Web dropdown controls after NagVis itself
            // has navigated. The selected map must survive both transitions.
            const hide = page.locator('a').filter({hasText:'Hide NagVis Menu'}).first();
            report.hideAnchor = await hide.evaluate(el => el.outerHTML.slice(0,650));
            await hide.evaluate(el => el.click());
            await page.waitForFunction(() => {
                const p = new URL(window.location.href);
                const iframe = document.querySelector('#nagvis-iframe');
                if (!iframe || !iframe.contentDocument
                    || iframe.contentDocument.readyState !== 'complete') return false;
                const c = new URL(iframe.contentWindow.location.href);
                return p.searchParams.get('map') === 'demo-overview'
                    && !p.searchParams.has('showMenu')
                    && p.searchParams.get('keep') === 'samemap'
                    && c.searchParams.get('show') === 'demo-overview'
                    && c.searchParams.get('header_menu') === '0';
            }, null, {timeout:12000});
            report.afterHide = {
                parentUrl: page.url(),
                childUrl: await page.locator('#nagvis-iframe')
                    .evaluate(el => el.contentWindow.location.href),
                menuLabels: await page.locator('a').evaluateAll(es => es
                    .map(el => el.textContent.trim()).filter(label => label.includes('NagVis Menu')))
            };
            if (!report.afterHide.menuLabels.includes('Show NagVis Menu'))
                throw Error('Icinga Web toggle did not switch to Show after hiding menu');

            const show = page.locator('a').filter({hasText:'Show NagVis Menu'}).first();
            report.showAnchor = await show.evaluate(el => el.outerHTML.slice(0,650));
            await show.evaluate(el => el.click());
            await page.waitForFunction(() => {
                const p = new URL(window.location.href);
                const iframe = document.querySelector('#nagvis-iframe');
                if (!iframe || !iframe.contentDocument
                    || iframe.contentDocument.readyState !== 'complete') return false;
                const c = new URL(iframe.contentWindow.location.href);
                return p.searchParams.get('map') === 'demo-overview'
                    && p.searchParams.get('showMenu') === '1'
                    && p.searchParams.get('keep') === 'samemap'
                    && c.searchParams.get('show') === 'demo-overview'
                    && c.searchParams.get('header_menu') === '1'
                    && iframe.contentDocument.body.innerText.includes('Open');
            }, null, {timeout:12000});
            report.afterShow = {
                parentUrl: page.url(),
                childUrl: await page.locator('#nagvis-iframe')
                    .evaluate(el => el.contentWindow.location.href),
                menuLabels: await page.locator('a').evaluateAll(es => es
                    .map(el => el.textContent.trim()).filter(label => label.includes('NagVis Menu')))
            };
            if (!report.afterShow.menuLabels.includes('Hide NagVis Menu'))
                throw Error('Icinga Web toggle did not switch to Hide after showing menu');
        }
        if(report.errors.length)throw Error('Browser errors: '+JSON.stringify(report.errors));
    }catch(e){report.failure=e.message;throw e;}finally{
        fs.writeFileSync(output+'.json',JSON.stringify(report,null,2));
        console.log('ACTUAL NAGVIS SAME MAP MENU INCONSISTENCY '+JSON.stringify(report,null,2));
        await browser.close();
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
