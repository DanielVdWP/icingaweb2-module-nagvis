<?php
declare(strict_types=1);
require __DIR__ . '/icingadb-bootstrap.php';
$variant = getenv('NAGVIS_VARIANT') ?: 'baseline';
$group = new class('ci-group') {
    private string $name;
    private string $exclude = '';
    public function __construct(string $name) { $this->name = $name; }
    public function getType(): string { return 'hostgroup'; }
    public function getName(): string { return $this->name; }
    public function getServiceDescription(): string { return ''; }
    public function hasExcludeFilters(bool $isCountQuery): bool { return $this->exclude !== ''; }
    public function getExcludeFilter(bool $isCountQuery): string { return $this->exclude; }
    public function exclude(string $expression): void { $this->exclude = $expression; }
};
function assertEq(string $case, mixed $actual, mixed $expected): void {
    if ($actual !== $expected) {
        throw new RuntimeException($case . ' expected=' . json_encode($expected)
            . ' actual=' . json_encode($actual));
    }
    echo 'PASS ' . $case . ': ' . json_encode($actual) . PHP_EOL;
}
function totals(array $result): array {
    if (! isset($result['ci-group']['counts'])) throw new RuntimeException('Real ci-group was not returned: '.json_encode($result));
    return array_map(static function ($bucket) { return (int)($bucket['normal'] ?? 0); }, $result['ci-group']['counts']);
}
if ($variant === 'baseline' || $variant === 'pr80') {
    // Real Icinga DB group query and aggregation; not a mocked ORM result.
    $withServices = totals($backend->getHostgroupStateCounts([[$group]], 0, []));
    $withoutServices = totals($backend->getHostgroupStateCounts([[$group]], 2, []));
    echo 'OBSERVE service enabled ' . json_encode($withServices) . PHP_EOL;
    echo 'OBSERVE service disabled ' . json_encode($withoutServices) . PHP_EOL;
    assertEq('hostgroup contains two healthy member hosts', $withServices[UP] ?? -1, 2);
    assertEq('hostgroup initially contains two critical member services', $withServices[CRITICAL] ?? -1, 2);
    if ($variant === 'baseline') {
        assertEq('baseline ignores recognize_services=0', $withoutServices[CRITICAL] ?? -1, 2);
    } else {
        assertEq('PR80 ignores critical services when recognize_services=0', $withoutServices[CRITICAL] ?? 0, 0);
        assertEq('PR80 retains up host count', $withoutServices[UP] ?? -1, 2);
    }
    $group->exclude('ci-child');
    $excludeHost = totals($backend->getHostgroupStateCounts([[$group]], 2, []));
    echo 'OBSERVE exclude host ' . json_encode($excludeHost) . PHP_EOL;
    if ($variant === 'baseline') {
        assertEq('baseline ignores member_exclude without regular filters', $excludeHost[UP] ?? -1, 2);
    } else {
        assertEq('PR80 applies member_exclude without regular filters', $excludeHost[UP] ?? -1, 1);
    }
    $group->exclude('ci-child~~ci-critical');
    $excludePair = totals($backend->getHostgroupStateCounts([[$group]], 0, []));
    echo 'OBSERVE exclude service pair ' . json_encode($excludePair) . PHP_EOL;
    if ($variant === 'baseline') {
        assertEq('baseline ignores service pair exclusion', $excludePair[CRITICAL] ?? -1, 2);
    } else {
        assertEq('PR80 removes only matching host-service pair', $excludePair[CRITICAL] ?? -1, 1);
        assertEq('PR80 keeps both healthy hosts on pair exclusion', $excludePair[UP] ?? -1, 2);
    }
} elseif ($variant === 'baseline81') {
    assertEq('baseline returns no direct parent relationships', $backend->getDirectParentNamesByHostName('ci-child'), []);
    assertEq('baseline returns no direct child relationships', $backend->getDirectChildNamesByHostName('ci-parent'), []);
} elseif ($variant === 'pr81old') {
    assertEq('schema v6 reports no dependency support',
        \Icinga\Module\Icingadb\Common\Backend::supportsDependencies(), false);
    assertEq('PR81 old schema returns empty parents', $backend->getDirectParentNamesByHostName('ci-child'), []);
    assertEq('PR81 old schema returns empty children', $backend->getDirectChildNamesByHostName('ci-parent'), []);
} elseif ($variant === 'pr81') {
    $parent = $backend->getDirectParentNamesByHostName('ci-child');
    $child = $backend->getDirectChildNamesByHostName('ci-parent');
    $childParent = $backend->getDirectParentDependenciesNamesByHostName('ci-child');
    $parentChild = $backend->getDirectChildDependenciesNamesByHostName('ci-parent');
    echo 'OBSERVE parents=' . json_encode($parent) . ' children=' . json_encode($child) . PHP_EOL;
    assertEq('PR81 direct parents of ci-child', $parent, ['ci-parent','ci-child2']);
    assertEq('PR81 children of ci-parent exclude service dependency', $child, ['ci-child','ci-child2']);
    assertEq('PR81 parent dependency interface', $childParent, $parent);
    assertEq('PR81 child dependency interface', $parentChild, $child);
    assertEq('PR81 non-existent host has no parents', $backend->getDirectParentNamesByHostName('ci-no-such-host'), []);
} else {
    throw new RuntimeException('Unknown test variant: '.$variant);
}
echo 'ALL ASSERTIONS PASSED: ' . $variant . PHP_EOL;
