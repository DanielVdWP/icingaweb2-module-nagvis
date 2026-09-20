<?php
declare(strict_types=1);
$pdo = new PDO('mysql:host=localhost;dbname=icingadb;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
function id(string $s): string { return sha1('nagvis-ci:' . $s, true); }
function row(PDO $db, string $table, array $data): void {
    if (! preg_match('/^[a-z_]+$/', $table)) throw new RuntimeException('Bad table');
    $cols = $db->query('SHOW COLUMNS FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
    $insert = [];
    foreach ($cols as $col) {
        $name = $col['Field']; $type = strtolower($col['Type']);
        if (array_key_exists($name, $data)) $insert[$name] = $data[$name];
        elseif ($col['Null'] === 'YES' || $col['Default'] !== null || str_contains($col['Extra'], 'auto_increment')) continue;
        elseif (str_starts_with($type, 'binary(')) $insert[$name] = str_repeat("\x00", (int) filter_var($type, FILTER_SANITIZE_NUMBER_INT));
        elseif (str_starts_with($type, 'enum(')) { preg_match("/^enum\('([^']+)'/", $type, $m); $insert[$name] = $m[1]; }
        elseif (preg_match('/^(int|tinyint|smallint|bigint|mediumint|decimal|float|double)/', $type)) $insert[$name] = 0;
        elseif (str_contains($type, 'json')) $insert[$name] = '{}';
        elseif (str_contains($type, 'date') || str_contains($type, 'time')) $insert[$name] = '2026-09-20 00:00:00';
        else $insert[$name] = '';
    }
    foreach ($data as $key => $_) if (! array_key_exists($key, $insert)) throw new RuntimeException("Bad column $table.$key");
    $names = implode(', ', array_keys($insert));
    $marks = implode(', ', array_fill(0, count($insert), '?'));
    $db->prepare("INSERT INTO $table ($names) VALUES ($marks)")->execute(array_values($insert));
}
$env = id('env');
row($pdo, 'environment', ['id'=>$env,'name'=>'NagVis CI']);
$group = id('group');
row($pdo,'hostgroup',['id'=>$group,'environment_id'=>$env,'name'=>'ci-group','name_ci'=>'ci-group',
 'display_name'=>'CI Group','name_checksum'=>id('g-name'),'properties_checksum'=>id('g-props')]);
$hosts=[];
foreach (['ci-parent','ci-child','ci-child2'] as $name) {
    $hid=id('host:'.$name);$hosts[$name]=$hid;
    row($pdo,'host',['id'=>$hid,'environment_id'=>$env,'name'=>$name,'name_ci'=>$name,'display_name'=>$name,
      'name_checksum'=>id('hn:'.$name),'properties_checksum'=>id('hp:'.$name),
      'checkcommand_id'=>id('hostcheck'),'checkcommand_name'=>'dummy','max_check_attempts'=>3,
      'check_interval'=>60,'check_retry_interval'=>30]);
    row($pdo,'host_state',['id'=>$hid,'host_id'=>$hid,'environment_id'=>$env,
      'properties_checksum'=>id('hs:'.$name),'state_type'=>'hard','soft_state'=>0,'hard_state'=>0,
      'is_reachable'=>'y','is_handled'=>'n','is_problem'=>'n',
      'last_state_change'=>1000,'next_check'=>1001,'next_update'=>1002]);
    if ($name!=='ci-child2') row($pdo,'hostgroup_member',['id'=>id('member:'.$name),
      'environment_id'=>$env,'host_id'=>$hid,'hostgroup_id'=>$group]);
    row($pdo,'dependency_node',['id'=>$hid,'environment_id'=>$env,'host_id'=>$hid]);
}
$services=[];
foreach ([['ci-parent','ci-critical',2],['ci-child','ci-warning',1],['ci-child','ci-critical',2]] as [$h,$name,$state]) {
    $sid=id("service:$h:$name");$services["$h::$name"]=$sid;
    row($pdo,'service',['id'=>$sid,'environment_id'=>$env,'host_id'=>$hosts[$h],
      'name'=>$name,'name_ci'=>$name,'display_name'=>$name,'name_checksum'=>id("sn:$h:$name"),
      'properties_checksum'=>id("sp:$h:$name"),'checkcommand_id'=>id('servicecheck'),
      'checkcommand_name'=>'dummy','max_check_attempts'=>3,'check_interval'=>60,'check_retry_interval'=>30]);
    row($pdo,'service_state',['id'=>$sid,'service_id'=>$sid,'host_id'=>$hosts[$h],
      'environment_id'=>$env,'properties_checksum'=>id("ss:$h:$name"),'state_type'=>'hard',
      'soft_state'=>$state,'hard_state'=>$state,'is_reachable'=>'y','is_handled'=>'n','is_problem'=>'y',
      'last_state_change'=>1000,'next_check'=>1001,'next_update'=>1002]);
    row($pdo,'dependency_node',['id'=>$sid,'environment_id'=>$env,'host_id'=>$hosts[$h],'service_id'=>$sid]);
}
foreach ([['ci-child','ci-parent'],['ci-child2','ci-parent'],['ci-child','ci-child2']] as [$child,$parent]) {
    $edge=id("edge:$child:$parent");$state=id("edge-state:$child:$parent");
    row($pdo,'dependency_edge_state',['id'=>$state,'environment_id'=>$env,'failed'=>'n']);
    row($pdo,'dependency_edge',['id'=>$edge,'environment_id'=>$env,'from_node_id'=>$hosts[$child],
      'to_node_id'=>$hosts[$parent],'dependency_edge_state_id'=>$state,'display_name'=>"$child -> $parent"]);
}
$state=id('edge-state:service');$edge=id('edge:service');
row($pdo,'dependency_edge_state',['id'=>$state,'environment_id'=>$env,'failed'=>'n']);
row($pdo,'dependency_edge',['id'=>$edge,'environment_id'=>$env,
    'from_node_id'=>$services['ci-child::ci-critical'],'to_node_id'=>$hosts['ci-parent'],
    'dependency_edge_state_id'=>$state,'display_name'=>'Service dependency is NOT a host edge']);
echo json_encode(['version'=>$pdo->query('SELECT version FROM icingadb_schema')->fetchColumn(),
    'hosts'=>$pdo->query('SELECT COUNT(*) FROM host')->fetchColumn(),
    'services'=>$pdo->query('SELECT COUNT(*) FROM service')->fetchColumn(),
    'edges'=>$pdo->query('SELECT COUNT(*) FROM dependency_edge')->fetchColumn()],JSON_PRETTY_PRINT).PHP_EOL;
