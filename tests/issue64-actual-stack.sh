#!/usr/bin/env bash
set -euo pipefail

# Disposable GitHub-hosted Ubuntu runner only. No external credentials.
mkdir -p /etc/icingaweb2/modules/nagvis /etc/icingaweb2/enabledModules
cat > /etc/icingaweb2/authentication.ini <<'EOF'
[autologin]
backend = external
EOF
cat > /etc/icingaweb2/roles.ini <<'EOF'
[TestAdministrators]
users = issue64test
permissions = *
EOF
cat > /etc/icingaweb2/config.ini <<'EOF'
[global]
show_stacktraces = 1

[logging]
log = php

[cookie]
path = /
EOF
cat > /etc/icingaweb2/modules/nagvis/config.ini <<'EOF'
[global]
default-map = demo-overview
baseurl = /nagvis
EOF
ln -sfn /usr/share/icingaweb2/modules/nagvis /etc/icingaweb2/enabledModules/nagvis
ln -sfn /usr/share/icingaweb2/modules/monitoring /etc/icingaweb2/enabledModules/monitoring
cat > /etc/apache2/conf-available/issue64-external-user.conf <<'EOF'
# TEST ONLY: inject a fixed identity into the actual Icinga Web PHP request.
<Directory "/usr/share/icingaweb2/public">
    SetEnv REMOTE_USER issue64test
</Directory>
<Directory "/usr/share/nagvis/share/">
    SetEnv REMOTE_USER issue64test
</Directory>
EOF
a2enconf issue64-external-user
apache2ctl -t
systemctl restart apache2

echo "=== Configure packaged NagVis to use actual Icinga Web integration ==="
python3 - <<'PY'
from pathlib import Path
import re

config = Path('/etc/nagvis/nagvis.ini.php')
text = config.read_text()
if not re.search(r'(?m)^\[global\]\s*$', text):
    raise SystemExit('No [global] section in packaged NagVis configuration')
for option in ('authmodule', 'authorisationmodule', 'logonmodule'):
    text = re.sub(r'(?m)^\s*' + option + r'\s*=[^\n]*\n', '', text)
text = re.sub(
    r'(?m)^(\[global\]\s*\n)',
    r'\1authmodule="CoreAuthModIcingaweb2"\n'
    r'authorisationmodule="CoreAuthorisationModIcingaweb2"\n'
    r'logonmodule="LogonIcingaweb2"\n',
    text,
    count=1,
)
config.write_text(text)

core = Path('/usr/share/nagvis/share/server/core/functions/core.php')
source = core.read_text()
bootstrap = r'''
use Icinga\Application\EmbeddedWeb;
require_once 'Icinga/Application/EmbeddedWeb.php';
require_once EmbeddedWeb::start('/usr/share/icingaweb2', '/etc/icingaweb2')
    ->getModuleManager()
    ->getModule('nagvis')
    ->getLibDir() . '/nagvis-includes/init.inc.php';
'''
if not source.startswith('<?php\n'):
    raise SystemExit('Unexpected packaged NagVis core bootstrap')
core.write_text(source.replace('<?php\n', '<?php\n' + bootstrap + '\n', 1))
PY
php -l /usr/share/nagvis/share/server/core/functions/core.php
# Read-only diagnostic instrumentation in the DISPOSABLE runner; not a product patch.
python3 - <<'PY'
from pathlib import Path

p = Path('/usr/share/icingaweb2/modules/nagvis/library/nagvis-includes/CoreAuthorisationModIcingaweb2.php')
src = p.read_text()
old = "        return $perms;\n"
new = ("        error_log('issue84-permissions ' . json_encode(array("
       "'auth' => $this->auth->isAuthenticated(), 'modules' => array_keys($perms),"
       " 'map' => $perms['Map'] ?? null)));\n" + old)
if src.count(old) != 1:
    raise SystemExit('Expected a single map-permission return statement')
p.write_text(src.replace(old, new))
PY
php -l /usr/share/icingaweb2/modules/nagvis/library/nagvis-includes/CoreAuthorisationModIcingaweb2.php
echo "=== Actual NagVis authentication configuration ==="
grep -E '^(authmodule|authorisationmodule|logonmodule|headermenu|urltarget|mapurl)\s*=' /etc/nagvis/nagvis.ini.php || true
systemctl restart apache2
echo "=== Real Icinga Web module response ==="
curl -sS -L --max-redirs 5 -c /tmp/issue64.cookies -b /tmp/issue64.cookies \
  -D "$RUNNER_TEMP/actual-module-headers.txt" -o "$RUNNER_TEMP/actual-module.html" \
  -w 'Icinga module HTTP %{http_code} final=%{url_effective} bytes=%{size_download}\n' \
  'http://127.0.0.1/icingaweb2/nagvis/show/map?map=demo-overview'
echo "=== Real standalone NagVis response ==="
curl -sS -L --max-redirs 5 -c /tmp/issue64.cookies -b /tmp/issue64.cookies \
  -D "$RUNNER_TEMP/actual-nagvis-headers.txt" -o "$RUNNER_TEMP/actual-nagvis.html" \
  -w 'NagVis frontend HTTP %{http_code} final=%{url_effective} bytes=%{size_download}\n' \
  'http://127.0.0.1/nagvis/frontend/nagvis-js/index.php?mod=Map&act=view&show=demo-overview&header_menu=0'
echo "=== Evidence in real response bodies ==="
grep -inE -m 8 'nagvis-iframe|NagVis|icingaweb|login|not authenticated|error|exception' \
 "$RUNNER_TEMP/actual-module.html" "$RUNNER_TEMP/actual-nagvis.html" \
 | cut -c1-380 || true
