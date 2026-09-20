#!/usr/bin/env python3
"""Create a test-only PR78 + PR81 composite from the exact original PR files.

Only PR81's added dependency lookup code is transferred to PR78.  Never
modify either contributor's PR; fail if upstream signatures have changed.
"""
from pathlib import Path
import re
base = Path('/tmp/issue77-pr78.php').read_text()
other = Path('/tmp/issue77-pr81.php').read_text()
replace_methods = [
    ('getDirectChildNamesByHostName', 'getDirectChildDependenciesNamesByHostName'),
    ('getDirectParentNamesByHostName', 'getDirectParentDependenciesNamesByHostName'),
]
for start, end in replace_methods:
    pattern = rf'    public function {start}\(.*?(?=    public function {end}\()'
    original = re.search(pattern, base, flags=re.S)
    addition = re.search(pattern, other, flags=re.S)
    if not original or not addition or 'getDirectRelatedHostNames' in original.group():
        raise SystemExit(f'Unexpected method code for {start}')
    base = base[:original.start()] + addition.group() + base[original.end():]
pattern = r'    private function getDirectRelatedHostNames\(.*?(?=    public function getHostNamesInHostgroup\()'
m = re.search(pattern, other, flags=re.S)
if not m or base.count('    public function getHostNamesInHostgroup(') != 1:
    raise SystemExit('Cannot isolate exact PR81 helper')
base = base.replace('    public function getHostNamesInHostgroup(', m.group() + '    public function getHostNamesInHostgroup(', 1)
for symbol in ('Backend', 'DependencyNode'):
    marker = ('use Icinga\\Module\\Icingadb\\Common\\Database;' if symbol == 'Backend'
              else 'use Icinga\\Module\\Icingadb\\Model\\Hostgroup;')
    import_line = ('use Icinga\\Module\\Icingadb\\Common\\Backend;\n' if symbol == 'Backend'
                   else 'use Icinga\\Module\\Icingadb\\Model\\DependencyNode;\n')
    if base.count(marker) != 1: raise SystemExit(f'Missing import marker: {marker}')
    base = base.replace(marker, import_line + marker, 1)
out = Path('/tmp/issue77-combined.php')
out.write_text(base)
print('Test-only composite created:', out, 'bytes:', out.stat().st_size)
