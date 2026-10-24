<?php
declare(strict_types=1);

// Start the session so it can be cleared.
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

// Clear authenticated data from the session.
$_SESSION = [];

// Expire the session cookie.
if (ini_get("session.use_cookies")) {
    $cookieParams = session_get_cookie_params();

    setcookie(
        session_name(),
        "",
        [
            "expires" => time() - 42000,
            "path" => $cookieParams["path"],
            "domain" => $cookieParams["domain"],
            "secure" => $cookieParams["secure"],
            "httponly" => $cookieParams["httponly"],
            "samesite" => $cookieParams["samesite"] ?? "Lax"
        ]
    );
}

// Destroy the server-side session.
session_destroy();

// Clear user details stored for frontend display.
header("Clear-Site-Data: \"cache\"");
header("Location: login.php");
exit;
