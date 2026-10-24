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

function activitiesRespond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function activitiesPostString(string $key): ?string
{
    $value = $_POST[$key] ?? "";
    return is_string($value) ? trim($value) : null;
}

function activitiesPositiveId(?string $value): ?int
{
    if ($value === null || preg_match('/\A[1-9][0-9]*\z/', $value) !== 1) {
        return null;
    }
    $id = filter_var($value, FILTER_VALIDATE_INT, ["options" => ["min_range" => 1]]);
    return $id === false ? null : $id;
}

function activitiesAssignmentDepartment(string $relatedRecord, ?int $ticketId): ?string
{
    if ($relatedRecord !== "" && $ticketId !== null) {
        return null;
    }
    if (preg_match('/\A(?:lead|deal):[1-9][0-9]*\z/', $relatedRecord) === 1) {
        return "Sales Staff";
    }
    if ($relatedRecord === "" && $ticketId !== null) {
        return "Customer Service Staff";
    }
    return null;
}

$sessionUserId = $_SESSION["user_id"] ?? null;
if (!is_int($sessionUserId) || $sessionUserId < 1) {
    activitiesRespond(401, [
        "success" => false,
        "code" => "session_expired",
        "message" => "Please log in to continue."
    ]);
}

$action = $_GET["action"] ?? "";
$method = $_SERVER["REQUEST_METHOD"] ?? "";
if (!(($method === "GET" && $action === "list") ||
    ($method === "POST" && in_array($action, ["create", "update", "delete"], true)))) {
    header("Allow: GET, POST");
    activitiesRespond(405, [
        "success" => false,
        "message" => "This Activities API operation is not supported."
    ]);
}

$transactionStarted = false;
try {
    require_once __DIR__ . "/config/database.php";

    $userQuery = $conn->prepare(
        "SELECT u.status, r.role_name
         FROM users AS u
         INNER JOIN roles AS r ON r.role_id = u.role_id
         WHERE u.user_id = ?
         LIMIT 1"
    );
    $userQuery->bind_param("i", $sessionUserId);
    $userQuery->execute();
    $currentUser = $userQuery->get_result()->fetch_assoc();
    $userQuery->close();

    if (!$currentUser || $currentUser["status"] !== "Active") {
        activitiesRespond(401, [
            "success" => false,
            "code" => "session_expired",
            "message" => "Your account is no longer active. Please log in again."
        ]);
    }

    $roleName = (string) $currentUser["role_name"];
    $managementRole = in_array($roleName, ["Admin", "Manager"], true);
    if (!$managementRole && !in_array($roleName, ["Sales Staff", "Customer Service Staff"], true)) {
        activitiesRespond(403, [
            "success" => false,
            "message" => "You are not authorized to access Activities."
        ]);
    }

    $csrfTokenKey = "activities_csrf_token";
    if ($method === "GET") {
        if (!isset($_SESSION[$csrfTokenKey]) ||
            !is_string($_SESSION[$csrfTokenKey]) ||
            preg_match('/\A[a-f0-9]{64}\z/', $_SESSION[$csrfTokenKey]) !== 1) {
            $_SESSION[$csrfTokenKey] = bin2hex(random_bytes(32));
        }

        $activitySql = "
            SELECT
                a.activity_id,
                a.activity_name,
                a.contact_id,
                a.lead_id,
                a.deal_id,
                a.ticket_id,
                a.activity_type,
                a.due_date,
                a.assigned_user_id,
                a.status,
                a.notes,
                c.customer_name,
                l.inquiry_event_name AS lead_name,
                d.inquiry_event_name AS deal_name,
                t.ticket_name,
                assigned.full_name AS assigned_staff_name,
                assigned.status AS assigned_staff_status,
                assigned_role.role_name AS assigned_staff_role,
                (a.due_date < CURRENT_DATE AND a.status NOT IN ('Completed', 'Cancelled')) AS is_overdue
            FROM activities AS a
            INNER JOIN contacts AS c ON c.contact_id = a.contact_id
            LEFT JOIN leads AS l ON l.lead_id = a.lead_id
            LEFT JOIN deals AS d ON d.deal_id = a.deal_id
            LEFT JOIN tickets AS t ON t.ticket_id = a.ticket_id
            INNER JOIN users AS assigned ON assigned.user_id = a.assigned_user_id
            INNER JOIN roles AS assigned_role ON assigned_role.role_id = assigned.role_id
        ";
        if ($roleName === "Sales Staff") {
            $activitySql .= "
                WHERE a.assigned_user_id = ?
                  AND (
                    (a.lead_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM leads AS access_lead
                        WHERE access_lead.lead_id = a.lead_id
                          AND access_lead.assigned_user_id = ?
                    ))
                    OR
                    (a.deal_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM deals AS access_deal
                        WHERE access_deal.deal_id = a.deal_id
                          AND access_deal.assigned_user_id = ?
                    ))
                  )
            ";
        } elseif ($roleName === "Customer Service Staff") {
            $activitySql .= "
                WHERE a.assigned_user_id = ?
                  AND EXISTS (
                    SELECT 1 FROM tickets AS access_ticket
                    WHERE access_ticket.ticket_id = a.ticket_id
                      AND access_ticket.assigned_user_id = ?
                  )
            ";
        }
        $activitySql .= " ORDER BY a.due_date ASC, a.activity_id DESC";

        $activityQuery = $conn->prepare($activitySql);
        if ($roleName === "Sales Staff") {
            $activityQuery->bind_param("iii", $sessionUserId, $sessionUserId, $sessionUserId);
        } elseif ($roleName === "Customer Service Staff") {
            $activityQuery->bind_param("ii", $sessionUserId, $sessionUserId);
        }
        $activityQuery->execute();
        $activities = $activityQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $activityQuery->close();

        $contactSql = "SELECT c.contact_id, c.customer_name FROM contacts AS c";
        if ($roleName === "Sales Staff") {
            $contactSql .= "
                WHERE EXISTS (
                    SELECT 1 FROM leads AS own_lead
                    WHERE own_lead.contact_id = c.contact_id
                      AND own_lead.assigned_user_id = ?
                )
                OR EXISTS (
                    SELECT 1 FROM deals AS own_deal
                    INNER JOIN leads AS deal_lead ON deal_lead.lead_id = own_deal.lead_id
                    WHERE deal_lead.contact_id = c.contact_id
                      AND own_deal.assigned_user_id = ?
                )
            ";
        } elseif ($roleName === "Customer Service Staff") {
            $contactSql .= "
                WHERE EXISTS (
                    SELECT 1 FROM tickets AS own_ticket
                    WHERE own_ticket.contact_id = c.contact_id
                      AND own_ticket.assigned_user_id = ?
                )
            ";
        }
        $contactSql .= " ORDER BY c.customer_name ASC, c.contact_id ASC";
        $contactQuery = $conn->prepare($contactSql);
        if ($roleName === "Sales Staff") {
            $contactQuery->bind_param("ii", $sessionUserId, $sessionUserId);
        } elseif ($roleName === "Customer Service Staff") {
            $contactQuery->bind_param("i", $sessionUserId);
        }
        $contactQuery->execute();
        $contacts = $contactQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $contactQuery->close();

        $leads = [];
        $deals = [];
        $tickets = [];
        if ($roleName !== "Customer Service Staff") {
            $leadSql = "
                SELECT lead_id, contact_id, inquiry_event_name
                FROM leads
            ";
            if ($roleName === "Sales Staff") {
                $leadSql .= " WHERE assigned_user_id = ?";
            }
            $leadSql .= " ORDER BY inquiry_event_name ASC, lead_id ASC";
            $leadQuery = $conn->prepare($leadSql);
            if ($roleName === "Sales Staff") {
                $leadQuery->bind_param("i", $sessionUserId);
            }
            $leadQuery->execute();
            $leads = $leadQuery->get_result()->fetch_all(MYSQLI_ASSOC);
            $leadQuery->close();

            $dealSql = "
                SELECT d.deal_id, l.contact_id, d.inquiry_event_name
                FROM deals AS d
                INNER JOIN leads AS l ON l.lead_id = d.lead_id
            ";
            if ($roleName === "Sales Staff") {
                $dealSql .= " WHERE d.assigned_user_id = ?";
            }
            $dealSql .= " ORDER BY d.inquiry_event_name ASC, d.deal_id ASC";
            $dealQuery = $conn->prepare($dealSql);
            if ($roleName === "Sales Staff") {
                $dealQuery->bind_param("i", $sessionUserId);
            }
            $dealQuery->execute();
            $deals = $dealQuery->get_result()->fetch_all(MYSQLI_ASSOC);
            $dealQuery->close();
        }

        if ($roleName !== "Sales Staff") {
            $ticketSql = "
                SELECT ticket_id, contact_id, ticket_name, assigned_user_id
                FROM tickets
            ";
            if ($roleName === "Customer Service Staff") {
                $ticketSql .= " WHERE assigned_user_id = ?";
            }
            $ticketSql .= " ORDER BY ticket_name ASC, ticket_id ASC";
            $ticketQuery = $conn->prepare($ticketSql);
            if ($roleName === "Customer Service Staff") {
                $ticketQuery->bind_param("i", $sessionUserId);
            }
            $ticketQuery->execute();
            $tickets = $ticketQuery->get_result()->fetch_all(MYSQLI_ASSOC);
            $ticketQuery->close();
        }

        $staffSql = "
            SELECT u.user_id, u.full_name, u.status, r.role_name
            FROM users AS u
            INNER JOIN roles AS r ON r.role_id = u.role_id
            WHERE u.status = 'Active'
              AND r.role_name IN ('Sales Staff', 'Customer Service Staff')
        ";
        if ($roleName === "Sales Staff" || $roleName === "Customer Service Staff") {
            $staffSql .= " AND u.user_id = ?";
        }
        $staffSql .= " ORDER BY u.full_name ASC, u.user_id ASC";
        $staffQuery = $conn->prepare($staffSql);
        if ($roleName === "Sales Staff" || $roleName === "Customer Service Staff") {
            $staffQuery->bind_param("i", $sessionUserId);
        }
        $staffQuery->execute();
        $staff = $staffQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $staffQuery->close();

        $csrfToken = $_SESSION[$csrfTokenKey];
        session_write_close();
        activitiesRespond(200, [
            "success" => true,
            "role" => $roleName,
            "user_id" => $sessionUserId,
            "activities" => $activities,
            "contacts" => $contacts,
            "leads" => $leads,
            "deals" => $deals,
            "tickets" => $tickets,
            "staff" => $staff,
            "csrf_token" => $csrfToken
        ]);
    }

    $headerToken = $_SERVER["HTTP_X_CSRF_TOKEN"] ?? "";
    $formToken = $_POST["csrf_token"] ?? "";
    $storedToken = $_SESSION[$csrfTokenKey] ?? "";
    if (!is_string($headerToken) || !is_string($formToken) ||
        !is_string($storedToken) || $storedToken === "" ||
        !hash_equals($storedToken, $headerToken) ||
        !hash_equals($storedToken, $formToken)) {
        activitiesRespond(403, [
            "success" => false,
            "code" => "csrf_invalid",
            "message" => "Your security token is no longer valid. Refresh Activities and try again."
        ]);
    }

    if ($action === "delete") {
        if (!$managementRole) {
            activitiesRespond(403, [
                "success" => false,
                "code" => "delete_forbidden",
                "message" => "Only Admin and Manager users may delete activities."
            ]);
        }
        $activityId = activitiesPositiveId(activitiesPostString("id"));
        if ($activityId === null) {
            activitiesRespond(422, [
                "success" => false,
                "code" => "invalid_activity_id",
                "message" => "Select a valid activity to delete."
            ]);
        }

        $scopeSql = "";
        if ($roleName === "Sales Staff") {
            $scopeSql = "
                AND a.assigned_user_id = ?
                AND (
                    EXISTS (SELECT 1 FROM leads AS l WHERE l.lead_id = a.lead_id AND l.assigned_user_id = ?)
                    OR EXISTS (SELECT 1 FROM deals AS d WHERE d.deal_id = a.deal_id AND d.assigned_user_id = ?)
                )
            ";
        } elseif ($roleName === "Customer Service Staff") {
            $scopeSql = "
                AND a.assigned_user_id = ?
                AND EXISTS (SELECT 1 FROM tickets AS t WHERE t.ticket_id = a.ticket_id AND t.assigned_user_id = ?)
            ";
        }
        $ownershipQuery = $conn->prepare(
            "SELECT a.activity_id FROM activities AS a WHERE a.activity_id = ? $scopeSql LIMIT 1"
        );
        if ($roleName === "Sales Staff") {
            $ownershipQuery->bind_param("iiii", $activityId, $sessionUserId, $sessionUserId, $sessionUserId);
        } elseif ($roleName === "Customer Service Staff") {
            $ownershipQuery->bind_param("iii", $activityId, $sessionUserId, $sessionUserId);
        } else {
            $ownershipQuery->bind_param("i", $activityId);
        }
        $ownershipQuery->execute();
        $ownedActivity = $ownershipQuery->get_result()->fetch_assoc();
        $ownershipQuery->close();
        if (!$ownedActivity) {
            activitiesRespond(404, [
                "success" => false,
                "code" => "activity_not_found",
                "message" => "The activity was not found or is not available to your account."
            ]);
        }

        $deleteQuery = $conn->prepare("DELETE FROM activities WHERE activity_id = ?");
        $deleteQuery->bind_param("i", $activityId);
        $deleteQuery->execute();
        $deleteQuery->close();
        activitiesRespond(200, ["success" => true, "message" => "Activity deleted successfully."]);
    }

    $activityId = $action === "update"
        ? activitiesPositiveId(activitiesPostString("id"))
        : null;
    $activityName = activitiesPostString("activity_name");
    $contactId = activitiesPositiveId(activitiesPostString("customer_id"));
    $relatedRecord = activitiesPostString("lead_deal_id");
    $ticketIdValue = activitiesPostString("ticket_id");
    $ticketId = $ticketIdValue === "" ? null : activitiesPositiveId($ticketIdValue);
    $activityType = activitiesPostString("activity_type");
    $dueDate = activitiesPostString("due_date");
    $assignedUserId = activitiesPositiveId(activitiesPostString("staff_id"));
    $status = activitiesPostString("status");
    $notes = activitiesPostString("notes");

    if ($action === "update" && $activityId === null) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_activity_id",
            "message" => "Select a valid activity to update."
        ]);
    }
    if ($activityName === null || $activityName === "" || mb_strlen($activityName, "UTF-8") > 150) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_activity_name",
            "message" => "Enter an activity name of 1 to 150 characters."
        ]);
    }
    if ($contactId === null) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_contact_id",
            "message" => "Select a valid existing customer."
        ]);
    }
    if ($ticketIdValue === null || ($ticketIdValue !== "" && $ticketId === null)) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_ticket_id",
            "message" => "Select a valid existing Ticket."
        ]);
    }
    if ($relatedRecord === null) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_related_record",
            "message" => "Select a valid related record."
        ]);
    }
    $department = activitiesAssignmentDepartment($relatedRecord, $ticketId);
    if ($department === null) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "related_record_required",
            "message" => "Choose exactly one related Lead, Deal, or Ticket. The current database requires one."
        ]);
    }
    if (!in_array($activityType, ["Call", "Email", "Meeting", "Other"], true)) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_activity_type",
            "message" => "Select Call, Email, Meeting, or Other."
        ]);
    }
    $date = DateTimeImmutable::createFromFormat("!Y-m-d", (string) $dueDate);
    if ($dueDate === null || !$date || $date->format("Y-m-d") !== $dueDate) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_due_date",
            "message" => "Enter a valid due date."
        ]);
    }
    if (!in_array($status, ["Upcoming", "In Progress", "Completed", "Cancelled"], true)) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_status",
            "message" => "Select Upcoming, In Progress, Completed, or Cancelled."
        ]);
    }
    if ($notes === null || mb_strlen($notes, "UTF-8") > 150) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_notes",
            "message" => "Notes must be 150 characters or fewer."
        ]);
    }
    if ($assignedUserId === null) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "invalid_assigned_staff",
            "message" => "Select an active staff member from the related record's department."
        ]);
    }

    $recordKind = "";
    $recordId = 0;
    if (preg_match('/\A(lead|deal):([1-9][0-9]*)\z/', $relatedRecord, $matches) === 1) {
        $recordKind = $matches[1];
        $parsedId = activitiesPositiveId($matches[2]);
        if ($parsedId === null) {
            activitiesRespond(422, [
                "success" => false,
                "code" => "invalid_related_record",
                "message" => "Select a valid related Lead or Deal."
            ]);
        }
        $recordId = $parsedId;
    }

    if ($recordKind === "lead") {
        $recordQuery = $conn->prepare(
            "SELECT contact_id, assigned_user_id FROM leads WHERE lead_id = ? LIMIT 1"
        );
        $recordQuery->bind_param("i", $recordId);
    } elseif ($recordKind === "deal") {
        $recordQuery = $conn->prepare(
            "SELECT l.contact_id, d.assigned_user_id
             FROM deals AS d
             INNER JOIN leads AS l ON l.lead_id = d.lead_id
             WHERE d.deal_id = ?
             LIMIT 1"
        );
        $recordQuery->bind_param("i", $recordId);
    } else {
        $recordQuery = $conn->prepare(
            "SELECT contact_id, assigned_user_id FROM tickets WHERE ticket_id = ? LIMIT 1"
        );
        $recordQuery->bind_param("i", $ticketId);
    }
    $recordQuery->execute();
    $related = $recordQuery->get_result()->fetch_assoc();
    $recordQuery->close();

    if (!$related) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "related_record_not_found",
            "message" => "The selected related record does not exist."
        ]);
    }
    if ((int) $related["contact_id"] !== $contactId) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "related_contact_mismatch",
            "message" => "The selected customer does not match the related record."
        ]);
    }

    $relatedOwnerId = (int) $related["assigned_user_id"];
    if ($roleName === "Sales Staff" &&
        ($department !== "Sales Staff" || $relatedOwnerId !== $sessionUserId)) {
        activitiesRespond(403, [
            "success" => false,
            "code" => "related_record_forbidden",
            "message" => "Sales Staff may use only their own assigned Leads or Deals."
        ]);
    }
    if ($roleName === "Customer Service Staff" &&
        ($department !== "Customer Service Staff" || $relatedOwnerId !== $sessionUserId)) {
        activitiesRespond(403, [
            "success" => false,
            "code" => "related_record_forbidden",
            "message" => "Customer Service Staff may use only their own assigned Tickets."
        ]);
    }

    $expectedStaffRole = $department;
    $staffQuery = $conn->prepare(
        "SELECT u.user_id
         FROM users AS u
         INNER JOIN roles AS r ON r.role_id = u.role_id
         WHERE u.user_id = ?
           AND u.status = 'Active'
           AND r.role_name = ?
         LIMIT 1"
    );
    $staffQuery->bind_param("is", $assignedUserId, $expectedStaffRole);
    $staffQuery->execute();
    $eligibleStaff = $staffQuery->get_result()->fetch_assoc();
    $staffQuery->close();
    if (!$eligibleStaff) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "ineligible_assignee",
            "message" => "The selected assignee must be an active " . $expectedStaffRole . " user."
        ]);
    }
    if (!$managementRole && $assignedUserId !== $sessionUserId) {
        activitiesRespond(403, [
            "success" => false,
            "code" => "assignment_forbidden",
            "message" => "Staff may assign an activity only to themselves."
        ]);
    }

    $contactQuery = $conn->prepare("SELECT contact_id FROM contacts WHERE contact_id = ? LIMIT 1");
    $contactQuery->bind_param("i", $contactId);
    $contactQuery->execute();
    $contactExists = $contactQuery->get_result()->fetch_assoc();
    $contactQuery->close();
    if (!$contactExists) {
        activitiesRespond(422, [
            "success" => false,
            "code" => "contact_not_found",
            "message" => "The selected customer does not exist."
        ]);
    }

    $conn->begin_transaction();
    $transactionStarted = true;
    if ($action === "update") {
        $scopeSql = "";
        if ($roleName === "Sales Staff") {
            $scopeSql = "
                AND a.assigned_user_id = ?
                AND (
                    EXISTS (SELECT 1 FROM leads AS l WHERE l.lead_id = a.lead_id AND l.assigned_user_id = ?)
                    OR EXISTS (SELECT 1 FROM deals AS d WHERE d.deal_id = a.deal_id AND d.assigned_user_id = ?)
                )
            ";
        } elseif ($roleName === "Customer Service Staff") {
            $scopeSql = "
                AND a.assigned_user_id = ?
                AND EXISTS (SELECT 1 FROM tickets AS t WHERE t.ticket_id = a.ticket_id AND t.assigned_user_id = ?)
            ";
        }
        $ownershipQuery = $conn->prepare(
            "SELECT a.activity_id FROM activities AS a WHERE a.activity_id = ? $scopeSql LIMIT 1 FOR UPDATE"
        );
        if ($roleName === "Sales Staff") {
            $ownershipQuery->bind_param("iiii", $activityId, $sessionUserId, $sessionUserId, $sessionUserId);
        } elseif ($roleName === "Customer Service Staff") {
            $ownershipQuery->bind_param("iii", $activityId, $sessionUserId, $sessionUserId);
        } else {
            $ownershipQuery->bind_param("i", $activityId);
        }
        $ownershipQuery->execute();
        $ownedActivity = $ownershipQuery->get_result()->fetch_assoc();
        $ownershipQuery->close();
        if (!$ownedActivity) {
            $conn->rollback();
            $transactionStarted = false;
            activitiesRespond(404, [
                "success" => false,
                "code" => "activity_not_found",
                "message" => "The activity was not found or is not available to your account."
            ]);
        }

        $leadId = $recordKind === "lead" ? $recordId : null;
        $dealId = $recordKind === "deal" ? $recordId : null;
        $ticketValue = $department === "Customer Service Staff" ? $ticketId : null;
        $updateQuery = $conn->prepare(
            "UPDATE activities
             SET activity_name = ?, contact_id = ?, lead_id = ?, deal_id = ?, ticket_id = ?,
                 activity_type = ?, due_date = ?, assigned_user_id = ?, status = ?, notes = ?
             WHERE activity_id = ?"
        );
        $updateQuery->bind_param(
            "siiiississi",
            $activityName,
            $contactId,
            $leadId,
            $dealId,
            $ticketValue,
            $activityType,
            $dueDate,
            $assignedUserId,
            $status,
            $notes,
            $activityId
        );
        $updateQuery->execute();
        $updateQuery->close();
        $conn->commit();
        $transactionStarted = false;
        activitiesRespond(200, ["success" => true, "message" => "Activity updated successfully."]);
    }

    $leadId = $recordKind === "lead" ? $recordId : null;
    $dealId = $recordKind === "deal" ? $recordId : null;
    $ticketValue = $department === "Customer Service Staff" ? $ticketId : null;
    $insertQuery = $conn->prepare(
        "INSERT INTO activities
            (activity_name, contact_id, lead_id, deal_id, ticket_id, activity_type,
             due_date, assigned_user_id, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $insertQuery->bind_param(
        "siiiississ",
        $activityName,
        $contactId,
        $leadId,
        $dealId,
        $ticketValue,
        $activityType,
        $dueDate,
        $assignedUserId,
        $status,
        $notes
    );
    $insertQuery->execute();
    $insertQuery->close();
    $conn->commit();
    $transactionStarted = false;
    activitiesRespond(201, ["success" => true, "message" => "Activity created successfully."]);
} catch (Throwable $e) {
    if ($transactionStarted && isset($conn) && $conn instanceof mysqli) {
        $conn->rollback();
    }
    error_log("Activities API error: " . $e->getMessage());
    activitiesRespond(500, [
        "success" => false,
        "message" => "Unable to process the activity. Please try again."
    ]);
}
