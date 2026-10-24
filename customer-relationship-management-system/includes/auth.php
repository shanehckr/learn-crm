<?php
declare(strict_types=1);

// Start a session only if one is not already active.
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

function requireLogin(): void
{
    if (
        !isset($_SESSION["user_id"], $_SESSION["role_id"], $_SESSION["role_name"]) ||
        !is_int($_SESSION["user_id"]) ||
        !is_int($_SESSION["role_id"]) ||
        !is_string($_SESSION["role_name"])
    ) {
        header("Location: /customer-relationship-management-system/login.php");
        exit;
    }
}

/** Require one of the specified roles after requireLogin(). */
function requireRole(array $allowedRoles): void
{
    requireLogin();

    // Normalize role names so capitalization does not affect access checks.
    $currentRole = strtolower(trim($_SESSION["role_name"]));

    $allowedRoles = array_map(
        static fn(string $role): string => strtolower(trim($role)),
        $allowedRoles
    );

    if (!in_array($currentRole, $allowedRoles, true)) {
        http_response_code(403);
        exit("Access denied.");
    }
}
