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

function respond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

if (
    !isset($_SESSION["user_id"], $_SESSION["role_name"]) ||
    !is_int($_SESSION["user_id"]) ||
    $_SESSION["user_id"] < 1 ||
    !is_string($_SESSION["role_name"])
) {
    respond(401, [
        "success" => false,
        "message" => "Please log in to continue."
    ]);
}

$roleName = trim($_SESSION["role_name"]);
$userId = $_SESSION["user_id"];

if (!in_array($roleName, [
    "Admin",
    "Manager",
    "Sales Staff",
    "Customer Service Staff"
], true)) {
    respond(403, [
        "success" => false,
        "message" => "You are not authorized to access contacts."
    ]);
}

if ($_SERVER["REQUEST_METHOD"] !== "GET" || ($_GET["action"] ?? "") !== "list") {
    respond(405, [
        "success" => false,
        "message" => "This contacts API operation is not supported."
    ]);
}

try {
    require_once __DIR__ . "/config/database.php";

    $staffAssignments = "
        SELECT l.contact_id, l.assigned_user_id
        FROM leads AS l
        WHERE l.assigned_user_id IS NOT NULL

        UNION

        SELECT l.contact_id, d.assigned_user_id
        FROM deals AS d
        INNER JOIN leads AS l ON l.lead_id = d.lead_id

        UNION

        SELECT t.contact_id, t.assigned_user_id
        FROM tickets AS t

        UNION

        SELECT a.contact_id, a.assigned_user_id
        FROM activities AS a
    ";

    $accessCondition = "";
    if ($roleName === "Sales Staff" || $roleName === "Customer Service Staff") {
        $accessCondition = "
            WHERE (
                EXISTS (
                    SELECT 1
                    FROM leads AS access_lead
                    WHERE access_lead.contact_id = c.contact_id
                      AND access_lead.assigned_user_id = ?
                )
                OR EXISTS (
                    SELECT 1
                    FROM deals AS access_deal
                    INNER JOIN leads AS access_deal_lead
                        ON access_deal_lead.lead_id = access_deal.lead_id
                    WHERE access_deal_lead.contact_id = c.contact_id
                      AND access_deal.assigned_user_id = ?
                )
                OR EXISTS (
                    SELECT 1
                    FROM tickets AS access_ticket
                    WHERE access_ticket.contact_id = c.contact_id
                      AND access_ticket.assigned_user_id = ?
                )
                OR EXISTS (
                    SELECT 1
                    FROM activities AS access_activity
                    WHERE access_activity.contact_id = c.contact_id
                      AND access_activity.assigned_user_id = ?
                )
            )
        ";
    }

    $sql = "
        SELECT
            c.contact_id,
            c.customer_name,
            c.email,
            c.contact_number,
            staff_assignment.assigned_user_id,
            staff.full_name AS assigned_staff_name
        FROM contacts AS c
        LEFT JOIN ($staffAssignments) AS staff_assignment
            ON staff_assignment.contact_id = c.contact_id
        LEFT JOIN users AS staff
            ON staff.user_id = staff_assignment.assigned_user_id
        $accessCondition
        ORDER BY c.customer_name ASC, c.contact_id ASC, staff.full_name ASC
    ";

    $statement = $conn->prepare($sql);
    if ($accessCondition !== "") {
        $statement->bind_param("iiii", $userId, $userId, $userId, $userId);
    }
    $statement->execute();
    $result = $statement->get_result();

    $contacts = [];
    while ($row = $result->fetch_assoc()) {
        $contactId = (int) $row["contact_id"];
        if (!isset($contacts[$contactId])) {
            $contacts[$contactId] = [
                "contact_id" => $contactId,
                "customer_name" => $row["customer_name"],
                "email" => $row["email"],
                "contact_number" => $row["contact_number"],
                "assigned_staff" => []
            ];
        }

        if ($row["assigned_user_id"] !== null) {
            $contacts[$contactId]["assigned_staff"][] = [
                "user_id" => (int) $row["assigned_user_id"],
                "full_name" => $row["assigned_staff_name"]
            ];
        }
    }

    $statement->close();

    respond(200, [
        "success" => true,
        "contacts" => array_values($contacts)
    ]);
} catch (Throwable $e) {
    error_log("Contacts API list error: " . $e->getMessage());
    respond(500, [
        "success" => false,
        "message" => "Unable to retrieve contacts. Please try again."
    ]);
}
