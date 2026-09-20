<?php
declare(strict_types=1);
error_reporting(E_ALL);

echo "BOOT: PHP " . PHP_VERSION . PHP_EOL;
foreach ([
    '/usr/share/icinga-php/ipl/vendor/autoload.php',
    '/usr/share/icinga-php/vendor/vendor/autoload.php',
    '/usr/share/php/Icinga/Application/EmbeddedWeb.php',
    '/usr/share/nagvis/share/server/core/defines/global.php',
    '/usr/share/nagvis/share/server/core/defines/matches.php',
    '/usr/share/nagvis/share/server/core/classes/GlobalBackendInterface.php',
] as $file) {
    echo "BOOT: loading $file (exists=" . (is_file($file) ? 'yes' : 'no') . ")" . PHP_EOL;
    if (! is_file($file)) throw new RuntimeException("Real dependency missing: $file");
    require_once $file;
}
$paths = [
    'Icinga\\Module\\Icingadb\\' => '/usr/share/icingaweb2/modules/icingadb/library/Icingadb/',
    'Icinga\\Module\\Nagvis\\' => __DIR__ . '/../../library/Nagvis/',
    'Icinga\\' => '/usr/share/php/Icinga/',
];
spl_autoload_register(static function ($class) use ($paths) {
    foreach ($paths as $prefix => $base) {
        if (str_starts_with($class, $prefix)) {
            $file = $base . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
            if (is_file($file)) require_once $file;
        }
    }
});
echo "BOOT: class DependencyNode " . (class_exists(\Icinga\Module\Icingadb\Model\DependencyNode::class) ? 'YES' : 'NO') . PHP_EOL;
echo "BOOT: class Backend " . (class_exists(\Icinga\Module\Icingadb\Common\Backend::class) ? 'YES' : 'NO') . PHP_EOL;
echo "BOOT: class SqlConfig " . (class_exists(\ipl\Sql\Config::class) ? 'YES' : 'NO') . PHP_EOL;
// Default administrator for independent backend smoke tests. The role-visibility
// suite explicitly replaces this identity with each actual restricted user.
\Icinga\Authentication\Auth::getInstance()->setUser(
    (new \Icinga\User('ci-backend-admin'))->setIsUnrestricted(true)
);

$config = new \ipl\Sql\Config([
    'db' => 'mysql', 'host' => 'localhost', 'dbname' => 'icingadb',
    'username' => 'root', 'charset' => 'utf8mb4'
]);
$db = new \ipl\Sql\Connection($config);
echo "BOOT: schema " . json_encode((new PDO('mysql:host=localhost;dbname=icingadb', 'root', ''))->query('SELECT version FROM icingadb_schema')->fetchAll()) . PHP_EOL;
\Icinga\Module\Icingadb\Common\Backend::setDb($db);
echo "BOOT: supportsDependencies " . (\Icinga\Module\Icingadb\Common\Backend::supportsDependencies() ? 'YES' : 'NO') . PHP_EOL;
$backendFile = getenv('NAGVIS_BACKEND_FILE') ?: __DIR__ . '/../../library/nagvis-includes/GlobalBackendicingadb.php';
echo "BOOT: backend file " . $backendFile . PHP_EOL;
require_once $backendFile;
$backend = new \GlobalBackendicingadb('icingadb');
echo "BOOT: backend " . get_class($backend) . PHP_EOL;
