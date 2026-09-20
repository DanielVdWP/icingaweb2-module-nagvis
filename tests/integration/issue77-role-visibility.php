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
