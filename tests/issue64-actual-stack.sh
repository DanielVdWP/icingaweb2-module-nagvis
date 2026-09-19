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
