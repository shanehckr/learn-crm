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

function leadsRespond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function leadsPostString(string $key): ?string
{
    $value = $_POST[$key] ?? "";
    return is_string($value) ? trim($value) : null;
}

function leadsNormalizePhone(string $phone): string
{
    return preg_replace('/\D+/', '', $phone) ?? "";
}

$sessionUserId = $_SESSION["user_id"] ?? null;
$sessionRole = $_SESSION["role_name"] ?? null;

if (
    !is_int($sessionUserId) ||
    $sessionUserId < 1 ||
    !is_string($sessionRole)
) {
    leadsRespond(401, [
        "success" => false,
        "code" => "session_expired",
        "message" => "Please log in to continue."
    ]);
}

$action = $_GET["action"] ?? "";
$method = $_SERVER["REQUEST_METHOD"] ?? "";

if (
    !(
        ($method === "GET" && $action === "list") ||
        ($method === "POST" && in_array($action, ["create", "create-deal", "update", "delete"], true))
    )
) {
    header("Allow: GET, POST");
    leadsRespond(405, [
        "success" => false,
        "message" => "This Leads API operation is not supported."
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
        leadsRespond(401, [
            "success" => false,
            "code" => "session_expired",
            "message" => "Your account is not authorized. Please log in again."
        ]);
    }

    $roleName = $currentUser["role_name"];
    if (!in_array($roleName, ["Admin", "Manager", "Sales Staff"], true)) {
        leadsRespond(403, [
            "success" => false,
            "message" => "You are not authorized to access Leads."
        ]);
    }

    $isSalesStaff = $roleName === "Sales Staff";
    $csrfTokenKey = "leads_csrf_token";

    if ($method === "GET") {
        if (
            !isset($_SESSION[$csrfTokenKey]) ||
            !is_string($_SESSION[$csrfTokenKey]) ||
            preg_match('/\A[a-f0-9]{64}\z/', $_SESSION[$csrfTokenKey]) !== 1
        ) {
            $_SESSION[$csrfTokenKey] = bin2hex(random_bytes(32));
        }

        $leadSql = "
            SELECT
                l.lead_id,
                l.inquiry_event_name,
                l.contact_id,
                l.assigned_user_id,
                l.stage,
                l.created_at,
                c.customer_name,
                c.email AS customer_email,
                c.contact_number AS customer_phone,
                assigned.full_name AS assigned_staff_name,
                assigned_role.role_name AS assigned_staff_role,
                assigned.status AS assigned_staff_status
            FROM leads AS l
            INNER JOIN contacts AS c ON c.contact_id = l.contact_id
            LEFT JOIN users AS assigned ON assigned.user_id = l.assigned_user_id
            LEFT JOIN roles AS assigned_role ON assigned_role.role_id = assigned.role_id
        ";

        if ($isSalesStaff) {
            $leadSql .= " WHERE l.assigned_user_id = ?";
        }
        $leadSql .= " ORDER BY l.created_at DESC, l.lead_id DESC";

        $leadQuery = $conn->prepare($leadSql);
        if ($isSalesStaff) {
            $leadQuery->bind_param("i", $sessionUserId);
        }
        $leadQuery->execute();
        $leads = $leadQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $leadQuery->close();

        $dealSql = "
            SELECT
                d.deal_id,
                d.lead_id,
                d.inquiry_event_name,
                d.assigned_user_id,
                d.stage,
                d.quotation_amount,
                c.customer_name,
                assigned.full_name AS assigned_staff_name,
                assigned_role.role_name AS assigned_staff_role,
                assigned.status AS assigned_staff_status
            FROM deals AS d
            INNER JOIN leads AS l ON l.lead_id = d.lead_id
            INNER JOIN contacts AS c ON c.contact_id = l.contact_id
            LEFT JOIN users AS assigned ON assigned.user_id = d.assigned_user_id
            LEFT JOIN roles AS assigned_role ON assigned_role.role_id = assigned.role_id
        ";
        if ($isSalesStaff) {
            $dealSql .= " WHERE d.assigned_user_id = ?";
        }
        $dealSql .= " ORDER BY d.created_at DESC, d.deal_id DESC";

        $dealQuery = $conn->prepare($dealSql);
        if ($isSalesStaff) {
            $dealQuery->bind_param("i", $sessionUserId);
        }
        $dealQuery->execute();
        $deals = $dealQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $dealQuery->close();

        $contactSql = "
            SELECT DISTINCT c.contact_id, c.customer_name, c.email, c.contact_number
            FROM contacts AS c
        ";
        if ($isSalesStaff) {
            $contactSql .= "
                WHERE EXISTS (
                    SELECT 1
                    FROM leads AS owned_lead
                    WHERE owned_lead.contact_id = c.contact_id
                      AND owned_lead.assigned_user_id = ?
                )
                OR EXISTS (
                    SELECT 1
                    FROM deals AS owned_deal
                    INNER JOIN leads AS owned_deal_lead
                        ON owned_deal_lead.lead_id = owned_deal.lead_id
                    WHERE owned_deal_lead.contact_id = c.contact_id
                      AND owned_deal.assigned_user_id = ?
                )
            ";
        }
        $contactSql .= " ORDER BY c.customer_name ASC, c.contact_id ASC";

        $contactQuery = $conn->prepare($contactSql);
        if ($isSalesStaff) {
            $contactQuery->bind_param("ii", $sessionUserId, $sessionUserId);
        }
        $contactQuery->execute();
        $contacts = $contactQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $contactQuery->close();

        $staffQuery = $conn->prepare(
            "SELECT u.user_id, u.full_name, u.status, r.role_name
             FROM users AS u
             INNER JOIN roles AS r ON r.role_id = u.role_id
             WHERE u.status = 'Active'
               AND r.role_name = 'Sales Staff'
             ORDER BY u.full_name ASC, u.user_id ASC"
        );
        $staffQuery->execute();
        $staff = $staffQuery->get_result()->fetch_all(MYSQLI_ASSOC);
        $staffQuery->close();

        if ($isSalesStaff) {
            $staff = array_values(array_filter(
                $staff,
                static fn(array $member): bool => (int) $member["user_id"] === $sessionUserId
            ));
        }

        $csrfToken = $_SESSION[$csrfTokenKey];
        session_write_close();

        leadsRespond(200, [
            "success" => true,
            "role" => $roleName,
            "user_id" => $sessionUserId,
            "leads" => $leads,
            "deals" => $deals,
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
    $storedToken = $_SESSION[$csrfTokenKey] ?? "";
    if (
        !is_string($submittedToken) ||
        !is_string($headerToken) ||
        !is_string($formToken) ||
        ($headerToken !== "" && $formToken !== "" && !hash_equals($headerToken, $formToken)) ||
        !is_string($storedToken) ||
        $storedToken === "" ||
        !hash_equals($storedToken, $submittedToken)
    ) {
        leadsRespond(403, [
            "success" => false,
            "code" => "csrf_invalid",
            "message" => "Your security token is no longer valid. Refresh Leads and try again."
        ]);
    }

    if ($action === "create-deal") {
        $eventName = leadsPostString("event_name");
        $contactChoice = leadsPostString("customer_id");
        $leadIdValue = leadsPostString("related_lead_id");
        $stage = leadsPostString("stage");
        $staffIdValue = leadsPostString("staff_id");
        $foodOrders = leadsPostString("food_orders");
        $guestCountValue = leadsPostString("guest_count");
        $eventDate = leadsPostString("event_date");
        $serviceArrangement = leadsPostString("service_arrangement");
        $quotationAmount = leadsPostString("quotation_amount");
        $setupRequirements = leadsPostString("setup_requirements");

        if (
            $eventName === null ||
            $contactChoice === null ||
            $leadIdValue === null ||
            $stage === null ||
            $staffIdValue === null ||
            $foodOrders === null ||
            $guestCountValue === null ||
            $eventDate === null ||
            $serviceArrangement === null ||
            $quotationAmount === null ||
            $setupRequirements === null
        ) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Deal fields must contain valid text values."
            ]);
        }

        $isNewCustomer = $contactChoice === "new";
        $contactId = $isNewCustomer
            ? null
            : filter_var($contactChoice, FILTER_VALIDATE_INT, [
                "options" => ["min_range" => 1]
            ]);
        $leadId = $isNewCustomer
            ? null
            : filter_var($leadIdValue, FILTER_VALIDATE_INT, [
                "options" => ["min_range" => 1]
            ]);

        if ($eventName === "" || mb_strlen($eventName, "UTF-8") > 150) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Enter an inquiry/event name of at most 150 characters."
            ]);
        }
        if ($isNewCustomer && mb_strlen($eventName, "UTF-8") > 80) {
            leadsRespond(400, [
                "success" => false,
                "message" => "For a new customer, the event name must be 80 characters or fewer so it fits the new related Lead."
            ]);
        }
        if (!$isNewCustomer && ($contactId === false || $leadId === false)) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select an existing customer and a related Lead."
            ]);
        }
        if ($isNewCustomer) {
            $customerName = leadsPostString("customer_name");
            $customerEmail = leadsPostString("customer_email");
            $customerPhone = leadsPostString("customer_phone");
            if ($customerName === null || $customerEmail === null || $customerPhone === null) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter valid customer name, email, and contact number values."
                ]);
            }
            $normalizedPhone = leadsNormalizePhone($customerPhone);
            if ($customerName === "" || mb_strlen($customerName, "UTF-8") > 150) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a customer name of 1 to 150 characters."
                ]);
            }
            if (
                mb_strlen($customerEmail, "UTF-8") > 100 ||
                ($customerEmail !== "" && !filter_var($customerEmail, FILTER_VALIDATE_EMAIL))
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a valid customer email address no longer than 100 characters."
                ]);
            }
            if (
                mb_strlen($customerPhone, "UTF-8") > 30 ||
                ($customerPhone !== "" &&
                    (
                        preg_match('/\A[+0-9().\- ]+\z/', $customerPhone) !== 1 ||
                        strlen($normalizedPhone) < 7 ||
                        strlen($normalizedPhone) > 15
                    ))
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a valid customer contact number."
                ]);
            }
            if ($customerEmail === "" && strlen($normalizedPhone) < 7) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Provide a valid customer email address or contact number."
                ]);
            }
        }
        if (!in_array($stage, [
            "Quotation Preparation",
            "Quotation Sent",
            "Negotiation",
            "Confirmed",
            "Declined"
        ], true)) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select a valid Deal stage."
            ]);
        }
        if ($foodOrders === "" || strlen($foodOrders) > 65535) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Enter food orders within the supported text length."
            ]);
        }

        $guestCount = filter_var($guestCountValue, FILTER_VALIDATE_INT, [
            "options" => ["min_range" => 1, "max_range" => 2147483647]
        ]);
        if ($guestCount === false) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Enter a valid positive number of guests."
            ]);
        }

        $validDate = static function (string $value): bool {
            if (
                preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $value) !== 1 ||
                $value < "1000-01-01"
            ) {
                return false;
            }
            $date = DateTimeImmutable::createFromFormat("!Y-m-d", $value);
            return $date !== false && $date->format("Y-m-d") === $value;
        };
        $validTime = static function (string $value): bool {
            return preg_match('/\A(?:[01]\d|2[0-3]):[0-5]\d\z/', $value) === 1;
        };

        if (!$validDate($eventDate)) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Enter a valid event date."
            ]);
        }
        if (!in_array($serviceArrangement, [
            "Customer Pickup",
            "Food Delivery",
            "On-site Catering"
        ], true)) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select a valid service arrangement."
            ]);
        }
        if ($quotationAmount === "") {
            $quotationAmount = "0.00";
        }
        if (
            preg_match('/\A\d{1,8}(?:\.\d{1,2})?\z/', $quotationAmount) !== 1 ||
            (float) $quotationAmount < 0
        ) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Enter a quotation amount between 0 and 99,999,999.99."
            ]);
        }

        $pickupDate = null;
        $pickupTime = null;
        $deliveryAddress = null;
        $deliveryDate = null;
        $deliveryTime = null;
        $eventVenue = null;
        $eventStartTime = null;
        $eventEndTime = null;

        if ($serviceArrangement === "Customer Pickup") {
            $pickupDateValue = leadsPostString("pickup_date");
            $pickupTimeValue = leadsPostString("pickup_time");
            if (
                $pickupDateValue === null ||
                $pickupTimeValue === null ||
                !$validDate($pickupDateValue) ||
                !$validTime($pickupTimeValue)
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a valid pickup date and time."
                ]);
            }
            $pickupDate = $pickupDateValue;
            $pickupTime = $pickupTimeValue . ":00";
        } elseif ($serviceArrangement === "Food Delivery") {
            $deliveryAddressValue = leadsPostString("delivery_address");
            $deliveryDateValue = leadsPostString("delivery_date");
            $deliveryTimeValue = leadsPostString("delivery_time");
            if (
                $deliveryAddressValue === null ||
                $deliveryDateValue === null ||
                $deliveryTimeValue === null ||
                $deliveryAddressValue === "" ||
                mb_strlen($deliveryAddressValue, "UTF-8") > 255 ||
                !$validDate($deliveryDateValue) ||
                !$validTime($deliveryTimeValue)
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a valid delivery address, date, and time."
                ]);
            }
            $deliveryAddress = $deliveryAddressValue;
            $deliveryDate = $deliveryDateValue;
            $deliveryTime = $deliveryTimeValue . ":00";
        } else {
            $eventVenueValue = leadsPostString("event_venue");
            $eventStartTimeValue = leadsPostString("event_start_time");
            $eventEndTimeValue = leadsPostString("event_end_time");
            if (
                $eventVenueValue === null ||
                $eventStartTimeValue === null ||
                $eventEndTimeValue === null ||
                $eventVenueValue === "" ||
                mb_strlen($eventVenueValue, "UTF-8") > 255 ||
                !$validTime($eventStartTimeValue) ||
                !$validTime($eventEndTimeValue) ||
                $eventStartTimeValue >= $eventEndTimeValue
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a valid venue and event start/end times."
                ]);
            }
            if ($setupRequirements !== "") {
                $foodOrders .= "\n\nSetup requirements:\n" . $setupRequirements;
                if (strlen($foodOrders) > 65535) {
                    leadsRespond(400, [
                        "success" => false,
                        "message" => "Food orders and setup requirements exceed the supported text length."
                    ]);
                }
            }
            $eventVenue = $eventVenueValue;
            $eventStartTime = $eventStartTimeValue . ":00";
            $eventEndTime = $eventEndTimeValue . ":00";
        }

        $requestedStaffId = null;
        if (!$isSalesStaff) {
            $requestedStaffId = filter_var($staffIdValue, FILTER_VALIDATE_INT, [
                "options" => ["min_range" => 1]
            ]);
            if ($requestedStaffId === false) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select an assigned staff member for this Deal."
                ]);
            }
        }

        $assignedUserId = $isSalesStaff ? $sessionUserId : $requestedStaffId;
        $assignedQuery = $conn->prepare(
            "SELECT u.user_id
             FROM users AS u
             INNER JOIN roles AS r ON r.role_id = u.role_id
             WHERE u.user_id = ?
               AND u.status = 'Active'
               AND r.role_name = 'Sales Staff'
             LIMIT 1"
        );
        $assignedQuery->bind_param("i", $assignedUserId);
        $assignedQuery->execute();
        $assignedUser = $assignedQuery->get_result()->fetch_assoc();
        $assignedQuery->close();
        if (!$assignedUser) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select an active Sales Staff user for this Deal."
            ]);
        }

        $conn->begin_transaction();
        if ($isNewCustomer) {
            $duplicateContact = null;
            if ($customerEmail !== "") {
                $emailLookup = $conn->prepare(
                    "SELECT contact_id
                     FROM contacts
                     WHERE email <> '' AND LOWER(email) = LOWER(?)
                     ORDER BY contact_id ASC
                     LIMIT 1
                     FOR UPDATE"
                );
                $emailLookup->bind_param("s", $customerEmail);
                $emailLookup->execute();
                $duplicateContact = $emailLookup->get_result()->fetch_assoc();
                $emailLookup->close();
            }
            if (!$duplicateContact && $normalizedPhone !== "") {
                $phoneLookup = $conn->prepare(
                    "SELECT contact_id
                     FROM contacts
                     WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(contact_number, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ?
                     ORDER BY contact_id ASC
                     LIMIT 1
                     FOR UPDATE"
                );
                $phoneLookup->bind_param("s", $normalizedPhone);
                $phoneLookup->execute();
                $duplicateContact = $phoneLookup->get_result()->fetch_assoc();
                $phoneLookup->close();
            }
            if ($duplicateContact) {
                $conn->rollback();
                leadsRespond(409, [
                    "success" => false,
                    "message" => "A Contact with that email address or contact number already exists. Select the existing customer instead."
                ]);
            }

            $contactInsert = $conn->prepare(
                "INSERT INTO contacts (customer_name, email, contact_number)
                 VALUES (?, ?, ?)"
            );
            $contactInsert->bind_param("sss", $customerName, $customerEmail, $customerPhone);
            $contactInsert->execute();
            $contactId = $contactInsert->insert_id;
            $contactInsert->close();

            $leadInsert = $conn->prepare(
                "INSERT INTO leads
                    (inquiry_event_name, contact_id, assigned_user_id, stage)
                 VALUES (?, ?, ?, 'New Inquiry')"
            );
            $leadInsert->bind_param("sii", $eventName, $contactId, $assignedUserId);
            $leadInsert->execute();
            $leadId = $leadInsert->insert_id;
            $leadInsert->close();
        }

        $leadSql = "
            SELECT lead_id, contact_id
            FROM leads
            WHERE lead_id = ?
              AND contact_id = ?
        ";
        if ($isSalesStaff) {
            $leadSql .= " AND assigned_user_id = ?";
        }
        $leadSql .= " LIMIT 1 FOR UPDATE";
        $leadQuery = $conn->prepare($leadSql);
        if ($isSalesStaff) {
            $leadQuery->bind_param("iii", $leadId, $contactId, $sessionUserId);
        } else {
            $leadQuery->bind_param("ii", $leadId, $contactId);
        }
        $leadQuery->execute();
        $lead = $leadQuery->get_result()->fetch_assoc();
        $leadQuery->close();
        if (!$lead) {
            $conn->rollback();
            leadsRespond(404, [
                "success" => false,
                "message" => "The selected customer and Lead do not match or are not available to your account."
            ]);
        }

        $existingDealQuery = $conn->prepare(
            "SELECT deal_id
             FROM deals
             WHERE lead_id = ?
             LIMIT 1
             FOR UPDATE"
        );
        $existingDealQuery->bind_param("i", $leadId);
        $existingDealQuery->execute();
        $existingDeal = $existingDealQuery->get_result()->fetch_assoc();
        $existingDealQuery->close();
        if ($existingDeal) {
            $conn->rollback();
            leadsRespond(409, [
                "success" => false,
                "message" => "A Deal already exists for the selected Lead."
            ]);
        }

        $insert = $conn->prepare(
            "INSERT INTO deals (
                inquiry_event_name,
                lead_id,
                assigned_user_id,
                stage,
                food_orders,
                number_of_guests,
                event_date,
                service_arrangement,
                pickup_date,
                pickup_time,
                delivery_address,
                delivery_date,
                delivery_time,
                event_venue,
                event_start_time,
                event_end_time,
                quotation_amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $insert->bind_param(
            "siississsssssssss",
            $eventName,
            $leadId,
            $assignedUserId,
            $stage,
            $foodOrders,
            $guestCount,
            $eventDate,
            $serviceArrangement,
            $pickupDate,
            $pickupTime,
            $deliveryAddress,
            $deliveryDate,
            $deliveryTime,
            $eventVenue,
            $eventStartTime,
            $eventEndTime,
            $quotationAmount
        );
        $insert->execute();
        $dealId = $insert->insert_id;
        $insert->close();
        $conn->commit();

        leadsRespond(201, [
            "success" => true,
            "message" => "Deal created successfully.",
            "deal_id" => $dealId,
            "lead_id" => (int) $leadId,
            "contact_id" => (int) $contactId
        ]);
    }

    if ($action === "create") {
        $eventName = leadsPostString("event_name");
        $stage = leadsPostString("stage");
        $contactIdValue = leadsPostString("customer_id");
        $customerName = leadsPostString("customer_name");
        $customerEmail = leadsPostString("customer_email");
        $customerPhone = leadsPostString("customer_phone");
        $staffIdValue = leadsPostString("staff_id");

        if (
            $eventName === null ||
            $stage === null ||
            $contactIdValue === null ||
            $customerName === null ||
            $customerEmail === null ||
            $customerPhone === null ||
            $staffIdValue === null
        ) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Lead fields must contain valid text values."
            ]);
        }

        if ($stage === "") {
            $stage = "New Inquiry";
        }

        if ($eventName === "" || mb_strlen($eventName, "UTF-8") > 80) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Enter an inquiry/event name of at most 80 characters."
            ]);
        }

        if (!in_array($stage, ["New Inquiry", "In Progress", "In Discussion", "Declined"], true)) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select a valid Lead stage."
            ]);
        }

        $selectedContactId = null;
        if ($contactIdValue !== "") {
            $selectedContactId = filter_var($contactIdValue, FILTER_VALIDATE_INT, [
                "options" => ["min_range" => 1]
            ]);
            if ($selectedContactId === false) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select a valid customer."
                ]);
            }
        }

        if ($selectedContactId === null) {
            $customerName = trim($customerName);
            $customerEmail = trim($customerEmail);
            $customerPhone = trim($customerPhone);
            $normalizedPhone = leadsNormalizePhone($customerPhone);
            if (
                strlen($normalizedPhone) < 7 &&
                preg_match('/^\+?63\s*$/', $customerPhone) === 1
            ) {
                $customerPhone = "";
                $normalizedPhone = "";
            }

            if ($customerName === "" || mb_strlen($customerName, "UTF-8") > 150) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a customer name of at most 150 characters."
                ]);
            }
            if (
                mb_strlen($customerEmail, "UTF-8") > 100 ||
                ($customerEmail !== "" && !filter_var($customerEmail, FILTER_VALIDATE_EMAIL))
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a valid email address no longer than 100 characters."
                ]);
            }
            if (mb_strlen($customerPhone, "UTF-8") > 30) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Contact number must be at most 30 characters."
                ]);
            }
            if (
                $customerPhone !== "" &&
                (
                    preg_match('/^[+0-9().\- ]+$/', $customerPhone) !== 1 ||
                    strlen($normalizedPhone) < 7 ||
                    strlen($normalizedPhone) > 15
                )
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a valid customer contact number."
                ]);
            }
            if ($customerEmail === "" && strlen($normalizedPhone) < 7) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Provide a valid customer email address or contact number."
                ]);
            }
        }

        $requestedStaffId = null;
        if (!$isSalesStaff && $staffIdValue !== "") {
            $requestedStaffId = filter_var($staffIdValue, FILTER_VALIDATE_INT, [
                "options" => ["min_range" => 1]
            ]);
            if ($requestedStaffId === false) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select a valid assigned staff member."
                ]);
            }
        }

        $conn->begin_transaction();

        $assignedUserId = $isSalesStaff ? $sessionUserId : $requestedStaffId;
        if ($assignedUserId !== null) {
            $assignedQuery = $conn->prepare(
                "SELECT u.user_id
                 FROM users AS u
                 INNER JOIN roles AS r ON r.role_id = u.role_id
                 WHERE u.user_id = ?
                   AND u.status = 'Active'
                   AND r.role_name = 'Sales Staff'
                 LIMIT 1"
            );
            $assignedQuery->bind_param("i", $assignedUserId);
            $assignedQuery->execute();
            $assignedUser = $assignedQuery->get_result()->fetch_assoc();
            $assignedQuery->close();
            if (!$assignedUser) {
                $conn->rollback();
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select an active Sales Staff user."
                ]);
            }
        }

        if ($isNewCustomer) {
            $duplicateContact = null;
            if ($customerEmail !== "") {
                $emailLookup = $conn->prepare(
                    "SELECT contact_id
                     FROM contacts
                     WHERE email <> '' AND LOWER(email) = LOWER(?)
                     ORDER BY contact_id ASC
                     LIMIT 1
                     FOR UPDATE"
                );
                $emailLookup->bind_param("s", $customerEmail);
                $emailLookup->execute();
                $duplicateContact = $emailLookup->get_result()->fetch_assoc();
                $emailLookup->close();
            }
            if (!$duplicateContact && $normalizedPhone !== "") {
                $phoneLookup = $conn->prepare(
                    "SELECT contact_id
                     FROM contacts
                     WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(contact_number, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ?
                     ORDER BY contact_id ASC
                     LIMIT 1
                     FOR UPDATE"
                );
                $phoneLookup->bind_param("s", $normalizedPhone);
                $phoneLookup->execute();
                $duplicateContact = $phoneLookup->get_result()->fetch_assoc();
                $phoneLookup->close();
            }
            if ($duplicateContact) {
                $conn->rollback();
                leadsRespond(409, [
                    "success" => false,
                    "message" => "A Contact with that email address or contact number already exists. Select the existing customer instead."
                ]);
            }

            $contactInsert = $conn->prepare(
                "INSERT INTO contacts (customer_name, email, contact_number)
                 VALUES (?, ?, ?)"
            );
            $contactInsert->bind_param("sss", $customerName, $customerEmail, $customerPhone);
            $contactInsert->execute();
            $contactId = $contactInsert->insert_id;
            $contactInsert->close();

            $leadInsert = $conn->prepare(
                "INSERT INTO leads
                    (inquiry_event_name, contact_id, assigned_user_id, stage)
                 VALUES (?, ?, ?, 'New Inquiry')"
            );
            $leadInsert->bind_param("sii", $eventName, $contactId, $assignedUserId);
            $leadInsert->execute();
            $leadId = $leadInsert->insert_id;
            $leadInsert->close();
        } else {
            $contactSql = "SELECT c.contact_id FROM contacts AS c WHERE c.contact_id = ?";
            if ($isSalesStaff) {
                $contactSql .= "
                    AND (
                        EXISTS (
                            SELECT 1 FROM leads AS owned_lead
                            WHERE owned_lead.contact_id = c.contact_id
                              AND owned_lead.assigned_user_id = ?
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM deals AS owned_deal
                            INNER JOIN leads AS owned_deal_lead
                                ON owned_deal_lead.lead_id = owned_deal.lead_id
                            WHERE owned_deal_lead.contact_id = c.contact_id
                              AND owned_deal.assigned_user_id = ?
                        )
                    )
                ";
            }
            $contactSql .= " LIMIT 1";
            $contactQuery = $conn->prepare($contactSql);
            if ($isSalesStaff) {
                $contactQuery->bind_param(
                    "iii",
                    $selectedContactId,
                    $sessionUserId,
                    $sessionUserId
                );
            } else {
                $contactQuery->bind_param("i", $selectedContactId);
            }
            $contactQuery->execute();
            $contact = $contactQuery->get_result()->fetch_assoc();
            $contactQuery->close();

            if (!$contact) {
                $conn->rollback();
                leadsRespond(404, [
                    "success" => false,
                    "message" => "The selected customer was not found or is not available to your account."
                ]);
            }
            $contactId = (int) $contact["contact_id"];
        }

        if ($assignedUserId === null) {
            $leadInsert = $conn->prepare(
                "INSERT INTO leads
                    (inquiry_event_name, contact_id, assigned_user_id, stage)
                 VALUES (?, ?, NULL, ?)"
            );
            $leadInsert->bind_param("sis", $eventName, $contactId, $stage);
        } else {
            $leadInsert = $conn->prepare(
                "INSERT INTO leads
                    (inquiry_event_name, contact_id, assigned_user_id, stage)
                 VALUES (?, ?, ?, ?)"
            );
            $leadInsert->bind_param("siis", $eventName, $contactId, $assignedUserId, $stage);
        }
        $leadInsert->execute();
        $leadId = $leadInsert->insert_id;
        $leadInsert->close();

        $conn->commit();
        leadsRespond(201, [
            "success" => true,
            "message" => "Lead created successfully.",
            "lead_id" => $leadId,
            "contact_id" => $contactId
        ]);
    }

    if ($action === "update") {
        $recordType = leadsPostString("record_type");
        if ($recordType === "deal") {
            $dealIdValue = leadsPostString("id");
            $eventName = leadsPostString("event_name");
            $stage = leadsPostString("stage");
            $staffIdValue = leadsPostString("staff_id");
            $quotationAmountValue = leadsPostString("quotation_amount");

            if (
                $dealIdValue === null ||
                $eventName === null ||
                $stage === null ||
                $staffIdValue === null ||
                $quotationAmountValue === null
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Deal fields must contain valid text values."
                ]);
            }

            $dealId = filter_var($dealIdValue, FILTER_VALIDATE_INT, [
                "options" => ["min_range" => 1]
            ]);
            if ($dealId === false) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select a valid Deal."
                ]);
            }
            if ($eventName === "" || mb_strlen($eventName, "UTF-8") > 150) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter an inquiry/event name of at most 150 characters."
                ]);
            }
            if (!in_array($stage, [
                "Quotation Preparation",
                "Quotation Sent",
                "Negotiation",
                "Confirmed",
                "Declined"
            ], true)) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select a valid Deal stage."
                ]);
            }
            if (
                !preg_match('/^\d{1,8}(?:\.\d{1,2})?$/', $quotationAmountValue) ||
                (float) $quotationAmountValue < 0
            ) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Enter a quotation amount between 0 and 99,999,999.99."
                ]);
            }

            $requestedStaffId = null;
            if (!$isSalesStaff) {
                $requestedStaffId = filter_var($staffIdValue, FILTER_VALIDATE_INT, [
                    "options" => ["min_range" => 1]
                ]);
                if ($requestedStaffId === false) {
                    leadsRespond(400, [
                        "success" => false,
                        "message" => "Select an assigned staff member for this Deal."
                    ]);
                }
            }

            $conn->begin_transaction();
            $dealQuery = $conn->prepare(
                "SELECT assigned_user_id
                 FROM deals
                 WHERE deal_id = ?
                 LIMIT 1
                 FOR UPDATE"
            );
            $dealQuery->bind_param("i", $dealId);
            $dealQuery->execute();
            $deal = $dealQuery->get_result()->fetch_assoc();
            $dealQuery->close();

            if (!$deal || ($isSalesStaff && (int) $deal["assigned_user_id"] !== $sessionUserId)) {
                $conn->rollback();
                leadsRespond(404, [
                    "success" => false,
                    "message" => "The selected Deal was not found or is not available to your account."
                ]);
            }

            $assignedUserId = $isSalesStaff ? $sessionUserId : $requestedStaffId;
            $assignedQuery = $conn->prepare(
                "SELECT u.user_id
                 FROM users AS u
                 INNER JOIN roles AS r ON r.role_id = u.role_id
                 WHERE u.user_id = ?
                   AND u.status = 'Active'
                   AND r.role_name = 'Sales Staff'
                 LIMIT 1"
            );
            $assignedQuery->bind_param("i", $assignedUserId);
            $assignedQuery->execute();
            $assignedUser = $assignedQuery->get_result()->fetch_assoc();
            $assignedQuery->close();
            if (!$assignedUser) {
                $conn->rollback();
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select an active Sales Staff user for this Deal."
                ]);
            }

            $update = $conn->prepare(
                "UPDATE deals
                 SET inquiry_event_name = ?, stage = ?, assigned_user_id = ?, quotation_amount = ?
                 WHERE deal_id = ?"
            );
            $update->bind_param(
                "ssisi",
                $eventName,
                $stage,
                $assignedUserId,
                $quotationAmountValue,
                $dealId
            );
            $update->execute();
            $update->close();
            $conn->commit();

            leadsRespond(200, [
                "success" => true,
                "message" => "Deal updated successfully.",
                "deal_id" => (int) $dealId
            ]);
        }

        if ($recordType !== "lead") {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select a valid record type."
            ]);
        }

        $leadIdValue = leadsPostString("id");
        $eventName = leadsPostString("event_name");
        $stage = leadsPostString("stage");
        $staffIdValue = leadsPostString("staff_id");

        if ($leadIdValue === null || $eventName === null || $stage === null || $staffIdValue === null) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Lead fields must contain valid text values."
            ]);
        }

        $leadId = filter_var($leadIdValue, FILTER_VALIDATE_INT, [
            "options" => ["min_range" => 1]
        ]);
        if ($leadId === false) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select a valid Lead."
            ]);
        }
        if ($eventName === "" || mb_strlen($eventName, "UTF-8") > 80) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Enter an inquiry/event name of at most 80 characters."
            ]);
        }
        if (!in_array($stage, ["New Inquiry", "In Progress", "In Discussion", "Declined"], true)) {
            leadsRespond(400, [
                "success" => false,
                "message" => "Select a valid Lead stage."
            ]);
        }

        $requestedStaffId = null;
        if (!$isSalesStaff && $staffIdValue !== "") {
            $requestedStaffId = filter_var($staffIdValue, FILTER_VALIDATE_INT, [
                "options" => ["min_range" => 1]
            ]);
            if ($requestedStaffId === false) {
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select a valid assigned staff member."
                ]);
            }
        }

        $conn->begin_transaction();
        $leadQuery = $conn->prepare(
            "SELECT assigned_user_id
             FROM leads
             WHERE lead_id = ?
             LIMIT 1
             FOR UPDATE"
        );
        $leadQuery->bind_param("i", $leadId);
        $leadQuery->execute();
        $lead = $leadQuery->get_result()->fetch_assoc();
        $leadQuery->close();

        if (!$lead || ($isSalesStaff && (int) $lead["assigned_user_id"] !== $sessionUserId)) {
            $conn->rollback();
            leadsRespond(404, [
                "success" => false,
                "message" => "The selected Lead was not found or is not available to your account."
            ]);
        }

        if ($lead["assigned_user_id"] !== null && $requestedStaffId === null) {
            $currentAssigneeQuery = $conn->prepare(
                "SELECT u.status, r.role_name
                 FROM users AS u
                 INNER JOIN roles AS r ON r.role_id = u.role_id
                 WHERE u.user_id = ?
                 LIMIT 1"
            );
            $currentAssignedUserId = (int) $lead["assigned_user_id"];
            $currentAssigneeQuery->bind_param("i", $currentAssignedUserId);
            $currentAssigneeQuery->execute();
            $currentAssignee = $currentAssigneeQuery->get_result()->fetch_assoc();
            $currentAssigneeQuery->close();

            if (
                !$currentAssignee ||
                $currentAssignee["status"] !== "Active" ||
                $currentAssignee["role_name"] !== "Sales Staff"
            ) {
                $conn->rollback();
                leadsRespond(422, [
                    "success" => false,
                    "code" => "assignment_correction_required",
                    "message" => "This Lead has an inactive or ineligible assignee. Select an active Sales Staff user to correct the assignment."
                ]);
            }
        }

        $assignedUserId = $isSalesStaff ? $sessionUserId : $requestedStaffId;
        if ($assignedUserId !== null) {
            $assignedQuery = $conn->prepare(
                "SELECT u.user_id
                 FROM users AS u
                 INNER JOIN roles AS r ON r.role_id = u.role_id
                 WHERE u.user_id = ?
                   AND u.status = 'Active'
                   AND r.role_name = 'Sales Staff'
                 LIMIT 1"
            );
            $assignedQuery->bind_param("i", $assignedUserId);
            $assignedQuery->execute();
            $assignedUser = $assignedQuery->get_result()->fetch_assoc();
            $assignedQuery->close();
            if (!$assignedUser) {
                $conn->rollback();
                leadsRespond(400, [
                    "success" => false,
                    "message" => "Select an active Sales Staff user."
                ]);
            }
        }

        if ($assignedUserId === null) {
            $update = $conn->prepare(
                "UPDATE leads
                 SET inquiry_event_name = ?, stage = ?, assigned_user_id = NULL
                 WHERE lead_id = ?"
            );
            $update->bind_param("ssi", $eventName, $stage, $leadId);
        } else {
            $update = $conn->prepare(
                "UPDATE leads
                 SET inquiry_event_name = ?, stage = ?, assigned_user_id = ?
                 WHERE lead_id = ?"
            );
            $update->bind_param("ssii", $eventName, $stage, $assignedUserId, $leadId);
        }
        $update->execute();
        $update->close();
        $conn->commit();

        leadsRespond(200, [
            "success" => true,
            "message" => "Lead updated successfully.",
            "lead_id" => (int) $leadId
        ]);
    }

    $recordType = leadsPostString("record_type");
    if (!in_array($recordType, ["lead", "deal"], true)) {
        leadsRespond(400, [
            "success" => false,
            "message" => "Select a valid record type."
        ]);
    }

    if ($roleName !== "Admin") {
        leadsRespond(403, [
            "success" => false,
            "message" => "Only an Admin can delete Leads or Deals."
        ]);
    }

    $leadIdValue = leadsPostString("id");
    if ($leadIdValue === null) {
        leadsRespond(400, [
            "success" => false,
            "message" => "Select a valid record."
        ]);
    }
    $recordId = filter_var($leadIdValue, FILTER_VALIDATE_INT, [
        "options" => ["min_range" => 1]
    ]);
    if ($recordId === false) {
        leadsRespond(400, [
            "success" => false,
            "message" => "Select a valid record."
        ]);
    }

    if ($recordType === "deal") {
        $conn->begin_transaction();
        $dealQuery = $conn->prepare(
            "SELECT deal_id
             FROM deals
             WHERE deal_id = ?
             LIMIT 1
             FOR UPDATE"
        );
        $dealQuery->bind_param("i", $recordId);
        $dealQuery->execute();
        $deal = $dealQuery->get_result()->fetch_assoc();
        $dealQuery->close();

        if (!$deal) {
            $conn->rollback();
            leadsRespond(404, [
                "success" => false,
                "message" => "The selected Deal was not found."
            ]);
        }

        $activityQuery = $conn->prepare(
            "SELECT EXISTS(
                SELECT 1 FROM activities WHERE deal_id = ?
             ) AS has_activity"
        );
        $activityQuery->bind_param("i", $recordId);
        $activityQuery->execute();
        $activityDependency = $activityQuery->get_result()->fetch_assoc();
        $activityQuery->close();

        if ($activityDependency["has_activity"]) {
            $conn->rollback();
            leadsRespond(409, [
                "success" => false,
                "message" => "This Deal cannot be deleted because it is linked to an Activity. Remove or reassign that Activity first."
            ]);
        }

        $delete = $conn->prepare("DELETE FROM deals WHERE deal_id = ?");
        $delete->bind_param("i", $recordId);
        $delete->execute();
        $delete->close();
        $conn->commit();

        leadsRespond(200, [
            "success" => true,
            "message" => "Deal deleted successfully.",
            "deal_id" => (int) $recordId
        ]);
    }

    $leadId = $recordId;
    $conn->begin_transaction();
    $leadQuery = $conn->prepare(
        "SELECT assigned_user_id
         FROM leads
         WHERE lead_id = ?
         LIMIT 1
         FOR UPDATE"
    );
    $leadQuery->bind_param("i", $leadId);
    $leadQuery->execute();
    $lead = $leadQuery->get_result()->fetch_assoc();
    $leadQuery->close();

    if (!$lead || ($isSalesStaff && (int) $lead["assigned_user_id"] !== $sessionUserId)) {
        $conn->rollback();
        leadsRespond(404, [
            "success" => false,
            "message" => "The selected Lead was not found or is not available to your account."
        ]);
    }

    $dependencyQuery = $conn->prepare(
        "SELECT
            EXISTS(SELECT 1 FROM deals WHERE lead_id = ?) AS has_deal,
            EXISTS(SELECT 1 FROM activities WHERE lead_id = ?) AS has_activity"
    );
    $dependencyQuery->bind_param("ii", $leadId, $leadId);
    $dependencyQuery->execute();
    $dependencies = $dependencyQuery->get_result()->fetch_assoc();
    $dependencyQuery->close();

    if ($dependencies["has_deal"] || $dependencies["has_activity"]) {
        $conn->rollback();
        leadsRespond(409, [
            "success" => false,
            "message" => "This Lead cannot be deleted because it is linked to a Deal or Activity. Remove or reassign that record first."
        ]);
    }

    $delete = $conn->prepare("DELETE FROM leads WHERE lead_id = ?");
    $delete->bind_param("i", $leadId);
    $delete->execute();
    $delete->close();
    $conn->commit();

    leadsRespond(200, [
        "success" => true,
        "message" => "Lead deleted successfully. The associated contact was kept.",
        "lead_id" => (int) $leadId
    ]);
} catch (mysqli_sql_exception $e) {
    if (isset($conn) && $conn instanceof mysqli) {
        try {
            $conn->rollback();
        } catch (Throwable $rollbackError) {
            error_log("Leads API rollback error: " . $rollbackError->getMessage());
        }
    }

    if ((int) $e->getCode() === 1451) {
        leadsRespond(409, [
            "success" => false,
            "message" => "This record is linked to another record and cannot be deleted."
        ]);
    }
    if ((int) $e->getCode() === 1062) {
        leadsRespond(409, [
            "success" => false,
            "message" => "A Deal already exists for the selected Lead."
        ]);
    }

    error_log("Leads API database error: " . $e->getMessage());
    leadsRespond(500, [
        "success" => false,
        "message" => "Unable to process this Lead request. Please try again."
    ]);
} catch (Throwable $e) {
    if (isset($conn) && $conn instanceof mysqli) {
        try {
            $conn->rollback();
        } catch (Throwable $rollbackError) {
            error_log("Leads API rollback error: " . $rollbackError->getMessage());
        }
    }

    error_log("Leads API error: " . $e->getMessage());
    leadsRespond(500, [
        "success" => false,
        "message" => "Unable to process this Lead request. Please try again."
    ]);
}
