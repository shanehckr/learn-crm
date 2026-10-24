<?php
declare(strict_types=1);

// Configure session security before starting the session.
ini_set("session.use_strict_mode", "1");
ini_set("session.use_only_cookies", "1");

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params([
        "httponly" => true,
        "secure" => false,         // Local XAMPP uses HTTP; enable secure cookies when using HTTPS.
        "samesite" => "Lax"
    ]);

    session_start();
}

// Allow only users with a valid authenticated session.
if (
    !isset($_SESSION["user_id"], $_SESSION["full_name"], $_SESSION["role_name"]) ||
    !is_int($_SESSION["user_id"]) ||
    !is_string($_SESSION["full_name"]) ||
    !is_string($_SESSION["role_name"])
) {
    header("Location: login.php");
    exit;
}

// Prevent browsers from caching the authenticated app shell.
header("Cache-Control: no-store, private");
header("X-Content-Type-Options: nosniff");

// Load the shared CRM layout after authentication.
require __DIR__ . "/includes/app-layout.php";
