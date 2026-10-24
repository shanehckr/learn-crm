<?php
declare(strict_types=1);

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

ini_set("session.use_strict_mode", "1");
ini_set("session.use_only_cookies", "1");

session_set_cookie_params([
    "httponly" => true,
    "secure" => false,     // Local XAMPP uses HTTP; enable secure cookies under HTTPS.
    "samesite" => "Lax"
]);

session_start();

header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");

function respond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

if (empty($_SESSION["user_id"])) {
    respond(401, [
        "success" => false,
        "message" => "Please log in to continue."
    ]);
}

if (($_SESSION["role_name"] ?? "") !== "Admin") {
    respond(403, [
        "success" => false,
        "message" => "You are not authorized to access account management."
    ]);
}

$action = $_GET["action"] ?? "";

if ($_SERVER["REQUEST_METHOD"] === "GET" && $action === "list") {
    try {
        require_once __DIR__ . "/config/database.php";

        if (empty($_SESSION["settings_csrf_token"])) {
            $_SESSION["settings_csrf_token"] = bin2hex(random_bytes(32));
        }

        $result = $conn->query(
            "SELECT
                u.user_id,
                u.full_name,
                u.username,
                u.email,
                u.role_id,
                r.role_name,
                u.status,
                u.created_at
             FROM users AS u
             INNER JOIN roles AS r ON r.role_id = u.role_id
             ORDER BY u.created_at DESC, u.user_id DESC"
        );

        respond(200, [
            "success" => true,
            "users" => $result->fetch_all(MYSQLI_ASSOC),
            "csrf_token" => $_SESSION["settings_csrf_token"]
        ]);
    } catch (Throwable $e) {
        error_log("Settings API list error: " . $e->getMessage());
        respond(500, [
            "success" => false,
            "message" => "Unable to retrieve user accounts. Please try again."
        ]);
    }
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && $action === "create") {
    $submittedToken = $_SERVER["HTTP_X_CSRF_TOKEN"] ?? "";
    $sessionToken = $_SESSION["settings_csrf_token"] ?? "";

    if (
        !is_string($submittedToken) ||
        !is_string($sessionToken) ||
        $sessionToken === "" ||
        !hash_equals($sessionToken, $submittedToken)
    ) {
        respond(403, [
            "success" => false,
            "message" => "Your session expired. Refresh Settings and try again."
        ]);
    }

    $fullName = $_POST["full_name"] ?? "";
    $username = $_POST["username"] ?? "";
    $email = $_POST["email"] ?? "";
    $roleName = $_POST["role"] ?? "";
    $password = $_POST["password"] ?? "";
    $confirmPassword = $_POST["confirm_password"] ?? "";

    if (
        !is_string($fullName) ||
        !is_string($username) ||
        !is_string($email) ||
        !is_string($roleName) ||
        !is_string($password) ||
        !is_string($confirmPassword)
    ) {
        respond(400, [
            "success" => false,
            "message" => "All account fields must be valid text."
        ]);
    }

    $fullName = trim($fullName);
    $username = trim($username);
    $email = trim($email);
    $roleName = trim($roleName);

    if (
        $fullName === "" ||
        $username === "" ||
        $email === "" ||
        $roleName === "" ||
        $password === "" ||
        $confirmPassword === ""
    ) {
        respond(400, [
            "success" => false,
            "message" => "All fields are required."
        ]);
    }

    if (mb_strlen($fullName, "UTF-8") > 100 || mb_strlen($username, "UTF-8") > 50) {
        respond(400, [
            "success" => false,
            "message" => "Full name must be at most 100 characters and username at most 50."
        ]);
    }

    if (mb_strlen($email, "UTF-8") > 150 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, [
            "success" => false,
            "message" => "Enter a valid email address no longer than 150 characters."
        ]);
    }

    if (mb_strlen($roleName, "UTF-8") > 50) {
        respond(400, [
            "success" => false,
            "message" => "Select a valid role."
        ]);
    }

    if (mb_strlen($password, "UTF-8") < 12 || strlen($password) > 72) {
        respond(400, [
            "success" => false,
            "message" => "Password must be at least 12 characters and no more than 72 bytes."
        ]);
    }

    if ($password !== $confirmPassword) {
        respond(400, [
            "success" => false,
            "message" => "The passwords do not match."
        ]);
    }

    try {
        require_once __DIR__ . "/config/database.php";

        $roleQuery = $conn->prepare(
            "SELECT role_id FROM roles WHERE role_name = ? LIMIT 1"
        );
        $roleQuery->bind_param("s", $roleName);
        $roleQuery->execute();
        $role = $roleQuery->get_result()->fetch_assoc();
        $roleQuery->close();

        if (!$role) {
            respond(400, [
                "success" => false,
                "message" => "Select a role that exists in the system."
            ]);
        }

        $duplicateQuery = $conn->prepare(
            "SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1"
        );
        $duplicateQuery->bind_param("ss", $username, $email);
        $duplicateQuery->execute();
        $duplicate = $duplicateQuery->get_result()->fetch_assoc();
        $duplicateQuery->close();

        if ($duplicate) {
            respond(409, [
                "success" => false,
                "message" => "That username or email is already in use."
            ]);
        }

        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        if ($passwordHash === false) {
            throw new RuntimeException("Password hashing failed.");
        }

        $roleId = (int) $role["role_id"];
        $status = "Active";
        $insert = $conn->prepare(
            "INSERT INTO users
                (full_name, username, email, role_id, password_hash, status)
             VALUES (?, ?, ?, ?, ?, ?)"
        );
        $insert->bind_param(
            "sssiss",
            $fullName,
            $username,
            $email,
            $roleId,
            $passwordHash,
            $status
        );
        $insert->execute();
        $userId = $insert->insert_id;
        $insert->close();

        respond(201, [
            "success" => true,
            "message" => "Account created successfully.",
            "user_id" => $userId
        ]);
    } catch (mysqli_sql_exception $e) {
        if ((int) $e->getCode() === 1062) {
            respond(409, [
                "success" => false,
                "message" => "That username or email is already in use."
            ]);
        }

        error_log("Settings API account creation error: " . $e->getMessage());
        respond(500, [
            "success" => false,
            "message" => "Unable to create the account. Please try again."
        ]);
    } catch (Throwable $e) {
        error_log("Settings API account creation error: " . $e->getMessage());
        respond(500, [
            "success" => false,
            "message" => "Unable to create the account. Please try again."
        ]);
    }
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && $action === "edit") {
    $submittedToken = $_SERVER["HTTP_X_CSRF_TOKEN"] ?? "";
    $sessionToken = $_SESSION["settings_csrf_token"] ?? "";

    if (
        !is_string($submittedToken) ||
        !is_string($sessionToken) ||
        $sessionToken === "" ||
        !hash_equals($sessionToken, $submittedToken)
    ) {
        respond(403, [
            "success" => false,
            "message" => "Your session expired. Refresh Settings and try again."
        ]);
    }

    $userIdValue = $_POST["user_id"] ?? "";
    $fullName = $_POST["full_name"] ?? "";
    $email = $_POST["email"] ?? "";
    $roleName = $_POST["role"] ?? "";
    $status = $_POST["status"] ?? "";

    if (
        !is_string($userIdValue) ||
        !is_string($fullName) ||
        !is_string($email) ||
        !is_string($roleName) ||
        !is_string($status)
    ) {
        respond(400, [
            "success" => false,
            "message" => "All account fields must be valid."
        ]);
    }

    $fullName = trim($fullName);
    $email = trim($email);
    $roleName = trim($roleName);
    $status = trim($status);

    $userId = filter_var($userIdValue, FILTER_VALIDATE_INT, [
        "options" => ["min_range" => 1]
    ]);
    if ($userId === false) {
        respond(400, [
            "success" => false,
            "message" => "Select a valid account to update."
        ]);
    }

    if ($fullName === "" || $email === "" || $roleName === "" || $status === "") {
        respond(400, [
            "success" => false,
            "message" => "Full name, email, role, and status are required."
        ]);
    }

    if (mb_strlen($fullName, "UTF-8") > 100) {
        respond(400, [
            "success" => false,
            "message" => "Full name must be at most 100 characters."
        ]);
    }

    if (mb_strlen($email, "UTF-8") > 150 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, [
            "success" => false,
            "message" => "Enter a valid email address no longer than 150 characters."
        ]);
    }

    if ($status !== "Active" && $status !== "Inactive") {
        respond(400, [
            "success" => false,
            "message" => "Select a valid account status."
        ]);
    }

    try {
        require_once __DIR__ . "/config/database.php";
        $conn->begin_transaction();

        // Lock user rows while checking whether another active Admin exists.
        $lockUsers = $conn->query("SELECT user_id FROM users ORDER BY user_id FOR UPDATE");
        $lockUsers->free();

        $accountQuery = $conn->prepare(
            "SELECT u.user_id, u.role_id, u.status, r.role_name
             FROM users AS u
             INNER JOIN roles AS r ON r.role_id = u.role_id
             WHERE u.user_id = ?
             LIMIT 1"
        );
        $accountQuery->bind_param("i", $userId);
        $accountQuery->execute();
        $account = $accountQuery->get_result()->fetch_assoc();
        $accountQuery->close();

        if (!$account) {
            $conn->rollback();
            respond(404, [
                "success" => false,
                "message" => "The selected account was not found."
            ]);
        }

        $roleQuery = $conn->prepare(
            "SELECT role_id, role_name FROM roles WHERE role_name = ? LIMIT 1"
        );
        $roleQuery->bind_param("s", $roleName);
        $roleQuery->execute();
        $role = $roleQuery->get_result()->fetch_assoc();
        $roleQuery->close();

        if (!$role) {
            $conn->rollback();
            respond(400, [
                "success" => false,
                "message" => "Select a role that exists in the system."
            ]);
        }

        $duplicateQuery = $conn->prepare(
            "SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1"
        );
        $duplicateQuery->bind_param("si", $email, $userId);
        $duplicateQuery->execute();
        $duplicate = $duplicateQuery->get_result()->fetch_assoc();
        $duplicateQuery->close();

        if ($duplicate) {
            $conn->rollback();
            respond(409, [
                "success" => false,
                "message" => "That email address is already in use."
            ]);
        }

        $roleId = (int) $role["role_id"];
        $roleName = $role["role_name"];
        $isAdmin = $account["role_name"] === "Admin";
        $willDemote = $isAdmin && $roleName !== "Admin";
        $willDeactivate = $isAdmin &&
            $account["status"] === "Active" &&
            $status === "Inactive";

        if (
            (int) $userId === (int) $_SESSION["user_id"] &&
            $status === "Inactive"
        ) {
            $conn->rollback();
            respond(400, [
                "success" => false,
                "message" => "You cannot deactivate your own Admin account."
            ]);
        }

        if ($account["role_name"] === "Admin" && $account["status"] === "Active" && ($willDemote || $willDeactivate)) {
            $activeAdminQuery = $conn->prepare(
                "SELECT COUNT(*) AS active_admin_count
                 FROM users AS u
                 INNER JOIN roles AS r ON r.role_id = u.role_id
                 WHERE r.role_name = 'Admin' AND u.status = 'Active'"
            );
            $activeAdminQuery->execute();
            $activeAdminCount = (int) $activeAdminQuery->get_result()->fetch_assoc()["active_admin_count"];
            $activeAdminQuery->close();

            if ($activeAdminCount <= 1) {
                $conn->rollback();
                respond(400, [
                    "success" => false,
                    "message" => "The last active Admin cannot be deactivated or demoted."
                ]);
            }
        }

        $update = $conn->prepare(
            "UPDATE users
             SET full_name = ?, email = ?, role_id = ?, status = ?
             WHERE user_id = ?"
        );
        $update->bind_param("ssisi", $fullName, $email, $roleId, $status, $userId);
        $update->execute();
        $updated = $update->affected_rows;
        $update->close();

        $conn->commit();

        respond(200, [
            "success" => true,
            "message" => "Account updated successfully.",
            "user_id" => (int) $userId,
            "unchanged" => $updated === 0
        ]);
    } catch (mysqli_sql_exception $e) {
        try {
            $conn->rollback();
        } catch (Throwable $rollbackError) {
            error_log("Settings API rollback error: " . $rollbackError->getMessage());
        }

        if ((int) $e->getCode() === 1062) {
            respond(409, [
                "success" => false,
                "message" => "That email address is already in use."
            ]);
        }

        error_log("Settings API account update error: " . $e->getMessage());
        respond(500, [
            "success" => false,
            "message" => "Unable to update the account. Please try again."
        ]);
    } catch (Throwable $e) {
        try {
            $conn->rollback();
        } catch (Throwable $rollbackError) {
            error_log("Settings API rollback error: " . $rollbackError->getMessage());
        }
        error_log("Settings API account update error: " . $e->getMessage());
        respond(500, [
            "success" => false,
            "message" => "Unable to update the account. Please try again."
        ]);
    }
}

if ($_SERVER["REQUEST_METHOD"] !== "GET" && $_SERVER["REQUEST_METHOD"] !== "POST") {
    header("Allow: GET, POST");
    respond(405, [
        "success" => false,
        "message" => "This request method is not supported."
    ]);
}

respond(400, [
    "success" => false,
    "message" => "Invalid or unsupported action."
]);
