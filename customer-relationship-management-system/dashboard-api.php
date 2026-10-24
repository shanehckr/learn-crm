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

function dashboardRespond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function dashboardRows(mysqli $conn, string $sql, ?int $userId = null): array
{
    $statement = $conn->prepare($sql);
    if ($userId !== null) {
        $statement->bind_param("i", $userId);
    }

    $statement->execute();
    $rows = $statement->get_result()->fetch_all(MYSQLI_ASSOC);
    $statement->close();

    return $rows;
}

function dashboardCount(mysqli $conn, string $sql, ?int $userId = null): int
{
    $rows = dashboardRows($conn, $sql, $userId);
    return (int) ($rows[0]["total"] ?? 0);
}

function dashboardStageCounts(array $rows, array $stages): array
{
    $counts = array_fill_keys($stages, 0);
    foreach ($rows as $row) {
        $stage = (string) ($row["stage"] ?? "");
        if (array_key_exists($stage, $counts)) {
            $counts[$stage] = (int) $row["total"];
        }
    }

    return $counts;
}

function dashboardStatusCounts(array $rows, array $statuses): array
{
    $counts = array_fill_keys($statuses, 0);
    foreach ($rows as $row) {
        $status = (string) ($row["status"] ?? "");
        if (array_key_exists($status, $counts)) {
            $counts[$status] = (int) $row["total"];
        }
    }

    return $counts;
}

$sessionUserId = $_SESSION["user_id"] ?? null;
if (!is_int($sessionUserId) || $sessionUserId < 1) {
    dashboardRespond(401, [
        "success" => false,
        "message" => "Please log in to view the dashboard."
    ]);
}

if (($_SERVER["REQUEST_METHOD"] ?? "") !== "GET") {
    header("Allow: GET");
    dashboardRespond(405, [
        "success" => false,
        "message" => "This dashboard operation is not supported."
    ]);
}

try {
    require_once __DIR__ . "/config/database.php";

    $currentUserRows = dashboardRows(
        $conn,
        "SELECT u.status, r.role_name
         FROM users AS u
         INNER JOIN roles AS r ON r.role_id = u.role_id
         WHERE u.user_id = ?
         LIMIT 1",
        $sessionUserId
    );
    $currentUser = $currentUserRows[0] ?? null;

    if (!$currentUser || $currentUser["status"] !== "Active") {
        dashboardRespond(401, [
            "success" => false,
            "message" => "Your account is not authorized. Please log in again."
        ]);
    }

    $roleName = (string) $currentUser["role_name"];
    if (!in_array($roleName, ["Manager", "Sales Staff", "Customer Service Staff"], true)) {
        dashboardRespond(403, [
            "success" => false,
            "message" => "You are not authorized to view this dashboard."
        ]);
    }

    if ($roleName === "Manager") {
        $leadStages = [
            "New Inquiry",
            "In Progress",
            "In Discussion",
            "Declined"
        ];
        $dealStages = [
            "Quotation Preparation",
            "Quotation Sent",
            "Negotiation",
            "Confirmed",
            "Declined"
        ];
        $ticketStatuses = ["Open", "Pending", "Resolved"];

        $leadCounts = dashboardRows(
            $conn,
            "SELECT stage, COUNT(*) AS total
             FROM leads
             GROUP BY stage"
        );
        $dealCounts = dashboardRows(
            $conn,
            "SELECT stage, COUNT(*) AS total
             FROM deals
             GROUP BY stage"
        );
        $ticketCounts = dashboardRows(
            $conn,
            "SELECT status, COUNT(*) AS total
             FROM tickets
             GROUP BY status"
        );

        $upcomingActivities = dashboardRows(
            $conn,
            "SELECT
                a.activity_name,
                CASE
                    WHEN l.lead_id IS NOT NULL THEN CONCAT('Lead: ', l.inquiry_event_name)
                    WHEN d.deal_id IS NOT NULL THEN CONCAT('Deal: ', d.inquiry_event_name)
                    WHEN t.ticket_id IS NOT NULL THEN CONCAT('Ticket: ', t.ticket_name)
                    ELSE c.customer_name
                END AS related_record,
                assigned.full_name AS assigned_staff,
                a.due_date,
                a.status
             FROM activities AS a
             INNER JOIN contacts AS c ON c.contact_id = a.contact_id
             INNER JOIN users AS assigned ON assigned.user_id = a.assigned_user_id
             LEFT JOIN leads AS l ON l.lead_id = a.lead_id
             LEFT JOIN deals AS d ON d.deal_id = a.deal_id
             LEFT JOIN tickets AS t ON t.ticket_id = a.ticket_id
             WHERE a.due_date >= CURRENT_DATE
               AND a.status IN ('Upcoming', 'In Progress')
             ORDER BY a.due_date ASC, a.activity_id DESC
             LIMIT 10"
        );
        $confirmedDeals = dashboardRows(
            $conn,
            "SELECT
                d.inquiry_event_name,
                c.customer_name,
                assigned.full_name AS assigned_staff,
                d.quotation_amount,
                d.created_at
             FROM deals AS d
             INNER JOIN leads AS l ON l.lead_id = d.lead_id
             INNER JOIN contacts AS c ON c.contact_id = l.contact_id
             INNER JOIN users AS assigned ON assigned.user_id = d.assigned_user_id
             WHERE d.stage = 'Confirmed'
             ORDER BY d.created_at DESC, d.deal_id DESC
             LIMIT 10"
        );

        $response = [
            "success" => true,
            "role" => $roleName,
            "metrics" => [
                "total_leads" => dashboardCount($conn, "SELECT COUNT(*) AS total FROM leads"),
                "active_deals" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total
                     FROM deals
                     WHERE stage NOT IN ('Confirmed', 'Declined')"
                ),
                "confirmed_deals" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total FROM deals WHERE stage = 'Confirmed'"
                ),
                "open_tickets" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total FROM tickets WHERE status = 'Open'"
                )
            ],
            "lead_stages" => dashboardStageCounts($leadCounts, $leadStages),
            "deal_stages" => dashboardStageCounts($dealCounts, $dealStages),
            "ticket_statuses" => dashboardStatusCounts($ticketCounts, $ticketStatuses),
            "upcoming_activities" => $upcomingActivities,
            "confirmed_deals_list" => $confirmedDeals
        ];
    } elseif ($roleName === "Sales Staff") {
        $leadStages = [
            "New Inquiry",
            "In Progress",
            "In Discussion",
            "Declined"
        ];
        $leadCounts = dashboardRows(
            $conn,
            "SELECT stage, COUNT(*) AS total
             FROM leads
             WHERE assigned_user_id = ?
             GROUP BY stage",
            $sessionUserId
        );
        $upcomingActivityCount = dashboardCount(
            $conn,
            "SELECT COUNT(*) AS total
             FROM activities AS a
             LEFT JOIN leads AS l ON l.lead_id = a.lead_id
             LEFT JOIN deals AS d ON d.deal_id = a.deal_id
             WHERE a.assigned_user_id = ?
               AND a.due_date >= CURRENT_DATE
               AND a.status IN ('Upcoming', 'In Progress')
               AND (
                    (a.lead_id IS NOT NULL AND l.assigned_user_id = a.assigned_user_id)
                    OR
                    (a.deal_id IS NOT NULL AND d.assigned_user_id = a.assigned_user_id)
               )",
            $sessionUserId
        );
        $upcomingActivities = dashboardRows(
            $conn,
            "SELECT
                a.activity_name,
                c.customer_name,
                CASE
                    WHEN l.lead_id IS NOT NULL THEN CONCAT('Lead: ', l.inquiry_event_name)
                    WHEN d.deal_id IS NOT NULL THEN CONCAT('Deal: ', d.inquiry_event_name)
                    ELSE ''
                END AS related_record,
                a.activity_type,
                a.due_date
             FROM activities AS a
             INNER JOIN contacts AS c ON c.contact_id = a.contact_id
             LEFT JOIN leads AS l ON l.lead_id = a.lead_id
             LEFT JOIN deals AS d ON d.deal_id = a.deal_id
             WHERE a.assigned_user_id = ?
               AND a.due_date >= CURRENT_DATE
               AND a.status IN ('Upcoming', 'In Progress')
               AND (
                    (a.lead_id IS NOT NULL AND l.assigned_user_id = a.assigned_user_id)
                    OR
                    (a.deal_id IS NOT NULL AND d.assigned_user_id = a.assigned_user_id)
               )
             ORDER BY a.due_date ASC, a.activity_id DESC
             LIMIT 10",
            $sessionUserId
        );
        $recentRecords = dashboardRows(
            $conn,
            "SELECT
                record_name,
                customer_name,
                record_type,
                current_stage,
                updated_at,
                record_id
             FROM (
                SELECT
                    l.assigned_user_id,
                    l.inquiry_event_name AS record_name,
                    c.customer_name,
                    'Lead' AS record_type,
                    l.stage AS current_stage,
                    l.updated_at,
                    l.lead_id AS record_id
                FROM leads AS l
                INNER JOIN contacts AS c ON c.contact_id = l.contact_id

                UNION ALL

                SELECT
                    d.assigned_user_id,
                    d.inquiry_event_name AS record_name,
                    c.customer_name,
                    'Deal' AS record_type,
                    d.stage AS current_stage,
                    d.updated_at,
                    d.deal_id AS record_id
                FROM deals AS d
                INNER JOIN leads AS l ON l.lead_id = d.lead_id
                INNER JOIN contacts AS c ON c.contact_id = l.contact_id
             ) AS assigned_records
             WHERE assigned_user_id = ?
             ORDER BY updated_at DESC, record_type ASC, record_id DESC
             LIMIT 10",
            $sessionUserId
        );

        $response = [
            "success" => true,
            "role" => $roleName,
            "metrics" => [
                "total_leads" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total FROM leads WHERE assigned_user_id = ?",
                    $sessionUserId
                ),
                "active_deals" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total
                     FROM deals
                     WHERE assigned_user_id = ?
                       AND stage NOT IN ('Confirmed', 'Declined')",
                    $sessionUserId
                ),
                "confirmed_deals" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total
                     FROM deals
                     WHERE assigned_user_id = ? AND stage = 'Confirmed'",
                    $sessionUserId
                ),
                "upcoming_activities" => $upcomingActivityCount
            ],
            "lead_stages" => dashboardStageCounts($leadCounts, $leadStages),
            "upcoming_activities_list" => $upcomingActivities,
            "recent_records" => $recentRecords
        ];
    } else {
        $ticketStatuses = ["Open", "Pending", "Resolved"];
        $ticketCounts = dashboardRows(
            $conn,
            "SELECT status, COUNT(*) AS total
             FROM tickets
             WHERE assigned_user_id = ?
             GROUP BY status",
            $sessionUserId
        );
        $upcomingFollowupCount = dashboardCount(
            $conn,
            "SELECT COUNT(*) AS total
             FROM activities AS a
             INNER JOIN tickets AS t ON t.ticket_id = a.ticket_id
             WHERE a.assigned_user_id = ?
               AND t.assigned_user_id = a.assigned_user_id
               AND a.due_date >= CURRENT_DATE
               AND a.status IN ('Upcoming', 'In Progress')",
            $sessionUserId
        );
        $ticketOverview = dashboardRows(
            $conn,
            "SELECT
                t.ticket_id,
                c.customer_name,
                t.status,
                t.priority
             FROM tickets AS t
             INNER JOIN contacts AS c ON c.contact_id = t.contact_id
             WHERE t.assigned_user_id = ?
             ORDER BY t.created_at DESC, t.ticket_id DESC
             LIMIT 10",
            $sessionUserId
        );
        $upcomingFollowups = dashboardRows(
            $conn,
            "SELECT
                a.activity_name,
                c.customer_name,
                a.due_date,
                a.status
             FROM activities AS a
             INNER JOIN tickets AS t ON t.ticket_id = a.ticket_id
             INNER JOIN contacts AS c ON c.contact_id = a.contact_id
             WHERE a.assigned_user_id = ?
               AND t.assigned_user_id = a.assigned_user_id
               AND a.due_date >= CURRENT_DATE
               AND a.status IN ('Upcoming', 'In Progress')
             ORDER BY a.due_date ASC, a.activity_id DESC
             LIMIT 10",
            $sessionUserId
        );
        $recentTickets = dashboardRows(
            $conn,
            "SELECT
                t.ticket_id,
                c.customer_name,
                t.description AS subject,
                t.status,
                t.priority,
                t.updated_at
             FROM tickets AS t
             INNER JOIN contacts AS c ON c.contact_id = t.contact_id
             WHERE t.assigned_user_id = ?
             ORDER BY t.updated_at DESC, t.ticket_id DESC
             LIMIT 10",
            $sessionUserId
        );

        $response = [
            "success" => true,
            "role" => $roleName,
            "metrics" => [
                "open_tickets" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total
                     FROM tickets
                     WHERE assigned_user_id = ? AND status = 'Open'",
                    $sessionUserId
                ),
                "pending_tickets" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total
                     FROM tickets
                     WHERE assigned_user_id = ? AND status = 'Pending'",
                    $sessionUserId
                ),
                "resolved_tickets" => dashboardCount(
                    $conn,
                    "SELECT COUNT(*) AS total
                     FROM tickets
                     WHERE assigned_user_id = ? AND status = 'Resolved'",
                    $sessionUserId
                ),
                "upcoming_followups" => $upcomingFollowupCount
            ],
            "ticket_statuses" => dashboardStatusCounts($ticketCounts, $ticketStatuses),
            "ticket_overview" => $ticketOverview,
            "upcoming_followups_list" => $upcomingFollowups,
            "recent_tickets" => $recentTickets
        ];
    }

    session_write_close();
    dashboardRespond(200, $response);
} catch (mysqli_sql_exception $exception) {
    error_log("Dashboard API database error: " . $exception->getMessage());
    dashboardRespond(500, [
        "success" => false,
        "message" => "Dashboard data is temporarily unavailable."
    ]);
}
