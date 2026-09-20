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
        await sameMap.click();
        await page.waitForTimeout(1250);
        report.after={
            parentUrl:page.url(),
            iframeUrl:await page.locator('#nagvis-iframe').evaluate(el=>el.contentWindow.location.href),
            openMenuCount:await frame.getByText('Open',{exact:true}).count(),
            menuLabel:await page.locator('a').evaluateAll(es=>es.map(e=>e.textContent.trim()).filter(x=>x.includes('NagVis Menu'))),
            mapBody:(await frame.locator('body').innerText()).slice(0,180)
        };
        const parent=new URL(report.after.parentUrl), child=new URL(report.after.iframeUrl);
        report.originalInconsistencyReproduced=parent.searchParams.get('map')==='demo-overview'
            && parent.searchParams.get('showMenu')==='1'
            && parent.searchParams.get('keep')==='samemap'
            && child.searchParams.get('show')==='demo-overview'
            && !child.searchParams.has('header_menu')
            && report.after.openMenuCount===0
            && report.after.menuLabel.includes('Hide NagVis Menu')
            && report.topNavigations.length===1;
        if(!report.originalInconsistencyReproduced)
            throw Error('Original hidden NagVis menu / stale Hide toggle did not reproduce');
        if(report.errors.length)throw Error('Browser errors: '+JSON.stringify(report.errors));
    }catch(e){report.failure=e.message;throw e;}finally{
        fs.writeFileSync(output+'.json',JSON.stringify(report,null,2));
        console.log('ACTUAL NAGVIS SAME MAP MENU INCONSISTENCY '+JSON.stringify(report,null,2));
        await browser.close();
    }
})().catch(e=>{console.error(e);process.exitCode=1;});
