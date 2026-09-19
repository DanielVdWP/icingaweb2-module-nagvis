# FAQ

## URLs to Icinga Web 2 views do not work

Ensure that `urltarget = "_top"` is set inside the `default` section
in the `nagvis.ini.php` configuration file.

## Map Path demo-overview.cfg doesn't exist

Specify a different `default-map` in the `nagvis.ini.php` configuration file.

## NagVis URLs conflict when Icinga Web 2 is served from the web root

When Icinga Web 2 is served from `/`, its NagVis module uses URLs such as
`/nagvis/show/map`. A standalone NagVis installation served from `/nagvis`
can intercept those URLs, causing the Icinga Web 2 module route to fail.

Configure the web server so that Icinga Web 2 and standalone NagVis use
**distinct URL paths**. For example, keep Icinga Web 2 at `/` and serve the
standalone NagVis application from `/nagvis-app`. Then set its URL in
`<ICINGAWEB_CONFIGDIR>/modules/nagvis/config.ini`:

```ini
[global]
baseurl = /nagvis-app
```

The `baseurl` option controls the standalone NagVis URL loaded inside the
module's iframe. It does **not** change the Icinga Web 2 module route
(`/nagvis/show/map`) or configure the web server. Moving the standalone
application to another path must be done in your web server configuration.

Alternatively, serve Icinga Web 2 under a separate base path such as
`/icingaweb2` and adjust the NagVis integration URLs (including
`[paths] htmlcgi` in `nagvis.ini.php`) to match your deployment.
