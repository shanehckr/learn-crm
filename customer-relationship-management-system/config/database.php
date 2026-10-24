<?php

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$configFile = dirname(__DIR__) . "/config.local.php";

if (!is_file($configFile)) {
    error_log("Database configuration file is missing.");
    http_response_code(500);
    exit("Application configuration error.");
}

$config = require $configFile;

try {
    $conn = new mysqli(
        $config["host"],
        $config["username"],
        $config["password"],
        $config["database"]
    );

    $conn->set_charset("utf8mb4");

} catch (mysqli_sql_exception $e) {
    error_log("Database connection failed: " . $e->getMessage());
    http_response_code(500);
    exit("A database connection error occurred.");
}
