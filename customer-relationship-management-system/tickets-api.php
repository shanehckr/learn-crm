<?php
declare(strict_types=1);

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

ini_set("session.use_strict_mode", "1");
ini_set("session.use_only_cookies", "1");

session_set_cookie_params([
    "httponly" => true,
    "secure" => false,
    "samesite" => "Lax"
]);

session_start();

header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");

function ticketsRespond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function ticketsPostString(string $key): ?string
{
    $value = $_POST[$key] ?? "";
    return is_string($value) ? trim($value) : null;
}

function ticketsPositiveId(?string $value): ?int
{
    if ($value === null || preg_match('/\A[1-9][0-9]*\z/', $value) !== 1) {
        return null;
    }

    $id = filter_var($value, FILTER_VALIDATE_INT, [
        "options" => ["min_range" => 1]
    ]);

    return $id === false ? null : $id;
}

$sessionUserId = $_SESSION["user_id"] ?? null;
if (!is_int($sessionUserId) || $sessionUserId < 1) {
    ticketsRespond(401, [
        "success" => false,
        "code" => "session_expired",
        "message" => "Please log in to continue."
    ]);
}

$action = $_GET["action"] ?? "";
$method = $_SERVER["REQUEST_METHOD"] ?? "";
$transactionStarted = false;

if (
    !(($method === "GET" && $action === "list") ||
      ($method === "POST" && in_array($action, ["create", "update", "delete"], true)))
) {
    header("Allow: GET, POST");
    ticketsRespond(405, [
        "success" => false,
        "message" => "This Tickets API operation is not supported."
    ]);
}

try {
    require_once __DIR__ . "/config/database.php";

    $currentUserQuery = $conn->prepare(
        "SELECT u.status, r.role_name
         FROM users AS u
         INNER JOIN roles AS r ON r.role_id = u.role_id
         WHERE u.user_id = ?
         LIMIT 1"
    );
    $currentUserQuery->bind_param("i", $sessionUserId);
    $currentUserQuery->execute();
    $currentUser = $currentUserQuery->get_result()->fetch_assoc();
    $currentUserQuery->close();

    if (!$currentUser || $currentUser["status"] !== "Active") {
        ticketsRespond(401, [
            "success" => false,
            "code" => "session_expired",
            "message" => "Your account is no longer active. Please log in again."
        ]);
    }

    $roleName = $currentUser["role_name"];
    if (!in_array($roleName, ["Admin", "Manager", "Customer Service Staff"], true)) {
        ticketsRespond(403, [
            "success" => false,
            "message" => "You are not authorized to access Tickets."
        ]);
    }

    if ($method === "GET") {
        $csrfTokenKey = "tickets_csrf_token";
        if (
            !isset($_SESSION[$csrfTokenKey]) ||
            !is_string($_SESSION[$csrfTokenKey]) ||
            preg_match('/\A[a-f0-9]{64}\z/', $_SESSION[$csrfTokenKey]) !== 1
        ) {
            $_SESSION[$csrfTokenKey] = bin2hex(random_bytes(32));
        }

        $ticketSql = "
            SELECT
                t.ticket_id,
                t.ticket_name,
                t.contact_id,
                t.description,
                t.status,
                t.priority,
                t.assigned_user_id,
                c.customer_name,
                assigned.full_name AS assigned_staff_name
            FROM tickets AS t
            INNER JOIN contacts AS c ON c.contact_id = t.contact_id
            INNER JOIN users AS assigned ON assigned.user_id = t.assigned_user_id
        ";
        if ($roleName === "Customer Service Staff") {
            $ticketSql .= " WHERE t.assigned_user_id = ?";
        }
        $ticketSql .= " ORDER BY t.created_at DESC, t.ticket_id DESC";

        $ticketQuery = $conn->prepare($ticketSql);
        if ($roleName === "Customer Service Staff") {
            $ticketQuery->bind_param("i", $sessionUserId);
        }
        $ticketQuery->execute();
        $tickets = $ticketQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $ticketQuery->close();

        $contactQuery = $conn->prepare(
            "SELECT contact_id, customer_name
             FROM contacts
             ORDER BY customer_name ASC, contact_id ASC"
        );
        $contactQuery->execute();
        $contacts = $contactQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $contactQuery->close();

        $staffSql = "
            SELECT u.user_id, u.full_name
            FROM users AS u
            INNER JOIN roles AS r ON r.role_id = u.role_id
            WHERE u.status = 'Active'
              AND r.role_name = 'Customer Service Staff'
        ";
        if ($roleName === "Customer Service Staff") {
            $staffSql .= " AND u.user_id = ?";
        }
        $staffSql .= " ORDER BY u.full_name ASC, u.user_id ASC";

        $staffQuery = $conn->prepare($staffSql);
        if ($roleName === "Customer Service Staff") {
            $staffQuery->bind_param("i", $sessionUserId);
        }
        $staffQuery->execute();
        $staff = $staffQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $staffQuery->close();

        $csrfToken = $_SESSION[$csrfTokenKey];
        session_write_close();

        ticketsRespond(200, [
            "success" => true,
            "role" => $roleName,
            "user_id" => $sessionUserId,
            "tickets" => $tickets,
            "contacts" => $contacts,
            "staff" => $staff,
            "csrf_token" => $csrfToken
        ]);
    }

    $headerToken = $_SERVER["HTTP_X_CSRF_TOKEN"] ?? "";
    $formToken = $_POST["csrf_token"] ?? "";
    $submittedToken = is_string($headerToken) && $headerToken !== ""
        ? $headerToken
        : $formToken;
    $storedToken = $_SESSION["tickets_csrf_token"] ?? "";

    if (
        !is_string($submittedToken) ||
        !is_string($headerToken) ||
        !is_string($formToken) ||
        ($headerToken !== "" && $formToken !== "" && !hash_equals($headerToken, $formToken)) ||
        !is_string($storedToken) ||
        preg_match('/\A[a-f0-9]{64}\z/', $storedToken) !== 1 ||
        !hash_equals($storedToken, $submittedToken)
    ) {
        ticketsRespond(403, [
            "success" => false,
            "code" => "csrf_invalid",
            "message" => "Your security token is no longer valid. Refresh Tickets and try again."
        ]);
    }

    if ($action === "delete" && $roleName !== "Admin") {
        ticketsRespond(403, [
            "success" => false,
            "code" => "forbidden",
            "message" => "Only an Admin can delete tickets."
        ]);
    }

    if ($action === "delete") {
        $ticketId = ticketsPositiveId(ticketsPostString("id"));
        if ($ticketId === null) {
            ticketsRespond(422, [
                "success" => false,
                "code" => "invalid_ticket_id",
                "message" => "Select a valid ticket to delete."
            ]);
        }

        $conn->begin_transaction();
        $transactionStarted = true;
        $ticketQuery = $conn->prepare(
            "SELECT ticket_id
             FROM tickets
             WHERE ticket_id = ?
             FOR UPDATE"
        );
        $ticketQuery->bind_param("i", $ticketId);
        $ticketQuery->execute();
        $ticket = $ticketQuery->get_result()->fetch_assoc();
        $ticketQuery->close();

        if (!$ticket) {
            $conn->rollback();
            $transactionStarted = false;
            ticketsRespond(404, [
                "success" => false,
                "code" => "ticket_not_found",
                "message" => "The selected ticket no longer exists."
            ]);
        }

        $activityQuery = $conn->prepare(
            "SELECT COUNT(*) AS activity_count
             FROM activities
             WHERE ticket_id = ?"
        );
        $activityQuery->bind_param("i", $ticketId);
        $activityQuery->execute();
        $activityCount = (int) $activityQuery->get_result()->fetch_assoc()["activity_count"];
        $activityQuery->close();

        if ($activityCount > 0) {
            $conn->rollback();
            $transactionStarted = false;
            ticketsRespond(409, [
                "success" => false,
                "code" => "ticket_has_activities",
                "message" => "This ticket cannot be deleted because it is linked to one or more activities."
            ]);
        }

        $deleteQuery = $conn->prepare(
            "DELETE FROM tickets WHERE ticket_id = ?"
        );
        $deleteQuery->bind_param("i", $ticketId);
        $deleteQuery->execute();
        $deleteQuery->close();
        $conn->commit();
        $transactionStarted = false;

        ticketsRespond(200, [
            "success" => true,
            "message" => "Ticket deleted successfully."
        ]);
    }

    $ticketName = ticketsPostString("ticket_name");
    $description = ticketsPostString("description");
    $contactId = $action === "create"
        ? ticketsPositiveId(ticketsPostString("customer_id"))
        : null;
    $status = ticketsPostString("status");
    $priority = ticketsPostString("priority");
    $assignedUserId = ticketsPositiveId(ticketsPostString("staff_id"));
    $ticketId = $action === "update"
        ? ticketsPositiveId(ticketsPostString("id"))
        : null;

    if ($action === "update" && $ticketId === null) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_ticket_id",
            "message" => "Select a valid ticket to update."
        ]);
    }
    if (
        $ticketName === null ||
        $ticketName === "" ||
        mb_strlen($ticketName, "UTF-8") > 150
    ) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_ticket_name",
            "message" => "Enter a ticket name of 1 to 150 characters."
        ]);
    }
    if (
        $description === null ||
        $description === "" ||
        mb_strlen($description, "UTF-8") > 150
    ) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_description",
            "message" => "Enter a concern description of 1 to 150 characters."
        ]);
    }
    if ($action === "create" && $contactId === null) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_contact_id",
            "message" => "Select a valid existing customer."
        ]);
    }
    if (!in_array($status, ["Open", "Pending", "Resolved"], true)) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_status",
            "message" => "Select a valid ticket status."
        ]);
    }
    if (!in_array($priority, ["High", "Medium", "Low"], true)) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_priority",
            "message" => "Select a valid ticket priority."
        ]);
    }
    if ($assignedUserId === null) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_assigned_staff",
            "message" => "Select an active Customer Service Staff member."
        ]);
    }
    if ($roleName === "Customer Service Staff" && $assignedUserId !== $sessionUserId) {
        ticketsRespond(403, [
            "success" => false,
            "code" => "assignment_forbidden",
            "message" => "Customer Service Staff can assign tickets only to themselves."
        ]);
    }

    if ($action === "create") {
        $contactQuery = $conn->prepare(
            "SELECT contact_id FROM contacts WHERE contact_id = ? LIMIT 1"
        );
        $contactQuery->bind_param("i", $contactId);
        $contactQuery->execute();
        $contactExists = $contactQuery->get_result()->fetch_assoc();
        $contactQuery->close();
        if (!$contactExists) {
            ticketsRespond(422, [
                "success" => false,
                "code" => "contact_not_found",
                "message" => "The selected customer does not exist."
            ]);
        }
    }

    $staffQuery = $conn->prepare(
        "SELECT u.user_id
         FROM users AS u
         INNER JOIN roles AS r ON r.role_id = u.role_id
         WHERE u.user_id = ?
           AND u.status = 'Active'
           AND r.role_name = 'Customer Service Staff'
         LIMIT 1"
    );
    $staffQuery->bind_param("i", $assignedUserId);
    $staffQuery->execute();
    $staffExists = $staffQuery->get_result()->fetch_assoc();
    $staffQuery->close();
    if (!$staffExists) {
        ticketsRespond(422, [
            "success" => false,
            "code" => "invalid_assigned_staff",
            "message" => "The selected staff member must be an active Customer Service Staff user."
        ]);
    }

    if ($action === "create") {
        $createQuery = $conn->prepare(
            "INSERT INTO tickets
                (ticket_name, contact_id, description, status, priority, assigned_user_id)
             VALUES (?, ?, ?, ?, ?, ?)"
        );
        $createQuery->bind_param(
            "sisssi",
            $ticketName,
            $contactId,
            $description,
            $status,
            $priority,
            $assignedUserId
        );
        $createQuery->execute();
        $createdTicketId = $createQuery->insert_id;
        $createQuery->close();

        ticketsRespond(201, [
            "success" => true,
            "message" => "Ticket created successfully.",
            "ticket_id" => $createdTicketId
        ]);
    }

    $conn->begin_transaction();
    $transactionStarted = true;
    $ownershipSql = "
        SELECT t.ticket_id, t.contact_id
        FROM tickets AS t
        INNER JOIN contacts AS c ON c.contact_id = t.contact_id
        WHERE t.ticket_id = ?
    ";
    if ($roleName === "Customer Service Staff") {
        $ownershipSql .= " AND t.assigned_user_id = ?";
    }
    $ownershipSql .= " FOR UPDATE";

    $ownershipQuery = $conn->prepare($ownershipSql);
    if ($roleName === "Customer Service Staff") {
        $ownershipQuery->bind_param("ii", $ticketId, $sessionUserId);
    } else {
        $ownershipQuery->bind_param("i", $ticketId);
    }
    $ownershipQuery->execute();
    $ticket = $ownershipQuery->get_result()->fetch_assoc();
    $ownershipQuery->close();

    if (!$ticket) {
        $conn->rollback();
        $transactionStarted = false;
        ticketsRespond(404, [
            "success" => false,
            "code" => "ticket_not_found",
            "message" => "The selected ticket does not exist or is not assigned to you."
        ]);
    }

    $updateQuery = $conn->prepare(
        "UPDATE tickets
         SET ticket_name = ?, description = ?, status = ?,
             priority = ?, assigned_user_id = ?
         WHERE ticket_id = ?"
    );
    $updateQuery->bind_param(
        "ssssii",
        $ticketName,
        $description,
        $status,
        $priority,
        $assignedUserId,
        $ticketId
    );
    $updateQuery->execute();
    $updateQuery->close();
    $conn->commit();
    $transactionStarted = false;

    ticketsRespond(200, [
        "success" => true,
        "message" => "Ticket updated successfully."
    ]);
} catch (mysqli_sql_exception $e) {
    if ($transactionStarted && isset($conn) && $conn instanceof mysqli) {
        try {
            $conn->rollback();
        } catch (Throwable $rollbackError) {
            error_log("Tickets API rollback error: " . $rollbackError->getMessage());
        }
        $transactionStarted = false;
    }

    if ($action === "delete" && (int) $e->getCode() === 1451) {
        ticketsRespond(409, [
            "success" => false,
            "code" => "ticket_has_related_records",
            "message" => "This ticket cannot be deleted because related records still reference it."
        ]);
    }

    error_log("Tickets API database error: " . $e->getMessage());
    ticketsRespond(500, [
        "success" => false,
        "message" => "Unable to process this ticket request. Please try again."
    ]);
} catch (Throwable $e) {
    if ($transactionStarted && isset($conn) && $conn instanceof mysqli) {
        try {
            $conn->rollback();
        } catch (Throwable $rollbackError) {
            error_log("Tickets API rollback error: " . $rollbackError->getMessage());
        }
    }

    error_log("Tickets API error: " . $e->getMessage());
    ticketsRespond(500, [
        "success" => false,
        "message" => "Unable to process this ticket request. Please try again."
    ]);
}
