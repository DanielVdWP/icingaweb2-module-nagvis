<?php
declare(strict_types=1);
require __DIR__ . '/icingadb-bootstrap.php';
\Icinga\Application\Logger::create(new \Icinga\Data\ConfigObject(['log' => 'none', 'level' => 'ERROR']));

$variant = getenv('NAGVIS_VARIANT') ?: 'main';
$roleType = getenv('NAGVIS_ROLE') ?: 'unrestricted';
$role = (new \Icinga\Authentication\Role())->setName('nagvis-ci-' . $roleType);
$user = new \Icinga\User('nagvis-ci-' . $roleType);
$restrictions = match ($roleType) {
    'unrestricted' => [],
    'objects' => ['icingadb/filter/objects' => 'host.name=ci-parent'],
    'hosts' => ['icingadb/filter/hosts' => 'host.name=ci-parent'],
    'services' => ['icingadb/filter/services' => 'service.name=ci-critical'],
    'combined' => [
        'icingadb/filter/objects' => 'host.name=ci-parent',
        'icingadb/filter/hosts' => 'host.name=ci-parent',
        'icingadb/filter/services' => 'service.name=ci-critical'
    ],
    default => throw new RuntimeException('Unknown role'),
};
if ($roleType === 'unrestricted') {
    $user->setIsUnrestricted(true);
    $role->setIsUnrestricted(true);
}
$role->setRestrictions($restrictions);
$user->setRoles([$role])->setRestrictions($restrictions);
\Icinga\Authentication\Auth::getInstance()->setUser($user);
echo 'AUTH ' . json_encode(['user'=>$user->getUsername(), 'unrestricted'=>$user->isUnrestricted(), 'restrictions'=>$restrictions]) . PHP_EOL;

function runCase(string $name, callable $callback): array {
    try {
        $result = $callback();
        echo "CASE $name " . json_encode($result, JSON_INVALID_UTF8_SUBSTITUTE) . PHP_EOL;
        return ['ok'=>true,'data'=>$result];
    } catch (\Throwable $e) {
        echo "EXCEPTION $name " . get_class($e) . ': ' . $e->getMessage() . PHP_EOL;
        return ['ok'=>false,'exception'=>get_class($e),'message'=>$e->getMessage()];
    }
}
$group = new class('ci-group') {
    public function __construct(private string $name) {}
    public function getType(): string { return 'hostgroup'; }
    public function getName(): string { return $this->name; }
    public function getServiceDescription(): string { return ''; }
    public function hasExcludeFilters(bool $isCountQuery): bool { return false; }
    public function getExcludeFilter(bool $isCountQuery): string { return ''; }
};
function groupCounts(array $result): array {
    if (! isset($result['ci-group']['counts'])) return ['missing_group'=>true,'result'=>$result];
    return array_map(static fn($bucket) => (int) ($bucket['normal'] ?? 0), $result['ci-group']['counts']);
}
$cases = [
  'hosts' => fn() => $backend->getObjects('host'),
  'services' => fn() => $backend->getObjects('service'),
  'hostgroups' => fn() => $backend->getObjects('hostgroup'),
  'hostgroup_members' => fn() => $backend->getHostNamesInHostgroup('ci-group'),
  'no_parent' => fn() => $backend->getHostNamesWithNoParent(),
  'group_counts' => fn() => groupCounts($backend->getHostgroupStateCounts([[$group]], 0, [])),
  'automap_children_of_parent' => fn() => $backend->getDirectChildNamesByHostName('ci-parent'),
  'automap_parents_of_child' => fn() => $backend->getDirectParentNamesByHostName('ci-child'),
];
$report=['variant'=>$variant,'role'=>$roleType,'cases'=>[]];
foreach ($cases as $name=>$f) $report['cases'][$name] = runCase($name,$f);
file_put_contents('/tmp/issue77-'.$variant.'-'.$roleType.'.json', json_encode($report,JSON_PRETTY_PRINT|JSON_INVALID_UTF8_SUBSTITUTE));
echo 'REPORT ' . json_encode(['variant'=>$variant,'role'=>$roleType,'errors'=>array_keys(array_filter($report['cases'],fn($x)=>!$x['ok']))]) . PHP_EOL;

function check(string $label, mixed $actual, mixed $expected): void {
    if ($actual !== $expected) {
        echo 'FAIL ' . $label . ' expected=' . json_encode($expected)
            . ' actual=' . json_encode($actual) . PHP_EOL;
        throw new RuntimeException('ROLE RESTRICTION REGRESSION: ' . $label);
    }
    echo 'PASS ' . $label . ' ' . json_encode($actual) . PHP_EOL;
}
foreach ($report['cases'] as $name=>$case) {
    if (! $case['ok']) throw new RuntimeException('A real ORM method failed: ' . $name . ': ' . $case['message']);
}
$names = static fn(array $items): array => array_map(static fn(array $item): string => $item['name1'], $items);
$visibilityExpected = ['ci-child','ci-child2','ci-parent'];
$visible = $report['cases']['hosts']['data'];
$serviceVisible = $report['cases']['services']['data'];
$normal = $roleType === 'unrestricted' || $variant === 'main' || $variant === 'pr81';
$restrictHosts = in_array($roleType, ['objects','hosts','combined'], true) && ! $normal;
$restrictServices = in_array($roleType, ['services','combined'], true) && ! $normal;
check('host picker ' . $variant . ' ' . $roleType,
    $names($visible), $restrictHosts ? ['ci-parent'] : $visibilityExpected);
check('service picker ' . $variant . ' ' . $roleType, count($serviceVisible),
    $restrictHosts ? 1 : ($restrictServices ? 2 : 3));
$counts = $report['cases']['group_counts']['data'];
check('hostgroup UP count ' . $variant . ' ' . $roleType,
    $counts[UP] ?? -1, $restrictHosts ? 1 : 2);
check('hostgroup CRITICAL count ' . $variant . ' ' . $roleType,
    $counts[CRITICAL] ?? -1, $restrictHosts ? 1 : 2);
check('hostgroup WARNING count ' . $variant . ' ' . $roleType,
    $counts[WARNING] ?? -1, $restrictHosts || $restrictServices ? 0 : 1);
$children = $report['cases']['automap_children_of_parent']['data'];
if (in_array($variant,['main','pr78'],true)) {
    check('existing Automap functions have no implementation ' . $variant, $children, []);
} elseif ($roleType === 'unrestricted' || $variant === 'pr81') {
    check('unfiltered PR81 returns real children', $children, ['ci-child','ci-child2']);
} elseif (in_array($roleType,['objects','hosts','combined'],true)) {
    // Intended safety criterion for the PR78+PR81 composite.
    // Neither child host is visible to the current user.
    check('restricted Automap MUST NOT disclose hidden children', $children, []);
}
echo 'ALL PERMISSION ASSERTIONS PASSED ' . $variant . ' ' . $roleType . PHP_EOL;

