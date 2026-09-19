// SPDX-FileCopyrightText: 2018 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

(function(Icinga) {

    var Nagvis = function(module) {

        this.module = module;

        this.idCache = {};

        this.initialize();

        this.module.icinga.logger.debug('Nagvis module loaded');
    };

    Nagvis.prototype = {

        initialize: function()
        {
            $('#nagvis-iframe').on('load', this.frameLoaded.bind(this));
        },

        frameLoaded: function (event) {
            var icinga = this.module.icinga;
            var frame = event.currentTarget;
            icinga.logger.debug('Nagvis frame loaded');

            if (! frame || ! frame.contentWindow) {
                return;
            }

            var framePath;
            var frameSearch;
            try {
                framePath = frame.contentWindow.location.pathname;
                frameSearch = frame.contentWindow.location.search;
            } catch (e) {
                // A different-origin NagVis installation cannot expose its URL to us.
                icinga.logger.debug('Nagvis frame location is not accessible; skipping map sync');
                return;
            }

            if (! /\/frontend\/nagvis-js\/index\.php$/.test(framePath)) {
                return;
            }

            var params = new URLSearchParams(frameSearch);
            if (params.get('mod') !== 'Map') {
                return;
            }

            var currentMap = params.get('show');
            var shownMap = new URLSearchParams(window.location.search).get('map');
            if (currentMap !== null && currentMap !== '' && shownMap !== currentMap) {
                this.setCurrentMap(currentMap);
            }
        },

        setCurrentMap: function (map) {
            var url = new URL(window.location.href);
            url.searchParams.set('map', map);
            this.module.icinga.logger.info('Setting current map', map);
            // Preserve showMenu when reloading, so the NagVis iframe also gets
            // the requested header_menu setting for the newly selected map.
            window.location.assign(url.toString());
        }

    };

    Icinga.availableModules.nagvis = Nagvis;

}(Icinga));

