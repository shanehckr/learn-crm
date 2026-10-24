<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars((string) $_SESSION["role_name"], ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8") ?> Dashboard</title>

    <!-- Restore the collapsed sidebar state before rendering. -->
    <script>
        (function () {
            if (localStorage.getItem('sidebarCollapsed') === 'true') {
                document.documentElement.classList.add('sidebar-is-collapsed');
            }
        })();
    </script>


    <!-- Sync display values with the authenticated session. -->
    <script>
        // These values control display only; PHP still enforces authorization.
        localStorage.setItem(
            "userRole",
            <?= json_encode(
                $_SESSION["role_name"],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
            ) ?>
        );

        localStorage.setItem(
            "userName",
            <?= json_encode(
                $_SESSION["full_name"],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
            ) ?>
        );
    </script>


    <!-- Apply the role class before rendering to prevent a sidebar flash. -->
    <script>
        (function () {
            var r = (localStorage.getItem('userRole') || 'admin').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (r === 'cs' || r === 'cs staff' || r === 'customer service staff') r = 'customer service';
            if (r === 'sales') r = 'sales staff';
            document.documentElement.classList.add('role-' + r.replace(/\s+/g, '-'));
        })();
    </script>
    <style>
        /* Hide items that do not allow this role; "all" is visible to everyone. */
        html.role-admin .nav-item[data-role]:not([data-role="all"]):not([data-role*="admin"]),
        html.role-manager .nav-item[data-role]:not([data-role="all"]):not([data-role*="manager"]),
        html.role-customer-service .nav-item[data-role]:not([data-role="all"]):not([data-role*="customer service"]),
        html.role-sales-staff .nav-item[data-role]:not([data-role="all"]):not([data-role*="sales staff"]) {
            display: none !important;
        }

        /* navbar.js fills in the subtitle, user name, and role. */
        html:not(.role-ready) .brand-subtitle,
        html:not(.role-ready) #dropdownUserName,
        html:not(.role-ready) #dropdownUserRole {
            visibility: hidden !important;
        }
    </style>
    <script>
        // Show the text if navbar.js fails to initialize.
        setTimeout(function () { document.documentElement.classList.add('role-ready'); }, 1500);
    </script>

    
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">

    
    <link rel="stylesheet" href="css-InAllPages/stylesheet-login.css">
    <link rel="stylesheet" href="css-InAllPages/navbar.css">
    <link rel="stylesheet" href="css-InAllPages/adminpages.css?v=3">
    <link rel="stylesheet" href="css-InAllPages/Notification.css">
    <link rel="stylesheet" href="css-InAllPages/settings.css?v=4">
    <script src="js-InAllPages/theme.js"></script>
</head>

<body>

    <div class="crm-layout">

        
        <aside class="crm-sidebar" id="crmSidebar">
            <div class="sidebar-header d-flex align-items-center justify-content-between px-3">
                <div class="brand-group">
                    <h1 class="brand-title m-0 fw-bold">CRM</h1>
                    <span class="brand-subtitle">
                        <?= htmlspecialchars($_SESSION["role_name"], ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8") ?>
                    </span>
                </div>
                <button class="btn p-0 border-0 burger-toggle-btn" id="burgerToggle"
                    aria-label="Toggle Sidebar Navigation">
                    <i class="bi bi-list fs-2"></i>
                </button>
            </div>

            <!-- data-role controls sidebar visibility; dashboard and report files are role-specific. -->
            <nav class="sidebar-nav px-2">
                <ul class="nav flex-column">
                    <li class="nav-item" data-role="all">
                        <a href="#" onclick="loadPage('dashboard', this); return false;"
                            class="nav-link d-flex align-items-center">
                            <img src="icons/dashboard-icon.svg" class="sidebar-icon" alt="Dashboard Icon">
                            <span class="nav-text ms-3">Dashboard</span>
                        </a>
                    </li>
                    <li class="nav-item" data-role="admin, manager, customer service, sales staff">
                        <a href="#" onclick="loadPage('contact.html', this); return false;"
                            class="nav-link d-flex align-items-center">
                            <img src="icons/contacts-icon.svg" class="sidebar-icon" alt="Contacts Icon">
                            <span class="nav-text ms-3">Contacts</span>
                        </a>
                    </li>
                    <li class="nav-item" data-role="admin, manager, sales staff">
                        <a href="#" onclick="loadPage('leadsanddeals.html', this); return false;"
                            class="nav-link d-flex align-items-center">
                            <img src="icons/leads-and-deals-icon.svg" class="sidebar-icon" alt="Leads & Deals Icon">
                            <span class="nav-text ms-3">Leads & Deals</span>
                        </a>
                    </li>
                    <li class="nav-item" data-role="admin, manager, customer service">
                        <a href="#" onclick="loadPage('ticket.html', this); return false;"
                            class="nav-link d-flex align-items-center">
                            <img src="icons/tickets-icon.svg" class="sidebar-icon" alt="Tickets Icon">
                            <span class="nav-text ms-3">Tickets</span>
                        </a>
                    </li>
                    <li class="nav-item" data-role="admin, manager, customer service, sales staff">
                        <a href="#" onclick="loadPage('activities.html', this); return false;"
                            class="nav-link d-flex align-items-center">
                            <img src="icons/activity-icon.svg" class="sidebar-icon" alt="Activities Icon">
                            <span class="nav-text ms-3">Activities</span>
                        </a>
                    </li>
                    <li class="nav-item" data-role="admin, manager, customer service, sales staff">
                        <a href="#" onclick="loadPage('reports', this); return false;"
                            class="nav-link d-flex align-items-center">
                            <img src="icons/report-icon.svg" class="sidebar-icon" alt="Reports Icon">
                            <span class="nav-text ms-3">Reports</span>
                        </a>
                    </li>
                    <li class="nav-item" data-role="admin">
                        <a href="#" onclick="loadPage('settings.html', this); return false;"
                            class="nav-link d-flex align-items-center">
                            <img src="icons/settings-icon.svg" class="sidebar-icon" alt="Settings Icon">
                            <span class="nav-text ms-3">Settings</span>
                        </a>
                    </li>
                </ul>
            </nav>
        </aside>

        
        <div class="crm-main-content d-flex flex-column flex-grow-1">

            
            <header class="top-navbar d-flex align-items-center justify-content-end px-4">
                <div class="top-navbar-actions d-flex align-items-center gap-3 gap-md-4">

                    
                    <button type="button" class="theme-toggle-header border-0 bg-transparent p-0" id="themeToggle"
                        aria-label="Toggle theme">
                        <img src="icons/sun-icon.svg" class="sun-icon" alt="Sun Icon">
                        <img src="icons/moon-icon.svg" class="moon-icon" alt="Moon Icon">
                    </button>

                    
                    <button class="btn-icon position-relative border-0 bg-transparent p-0" id="notificationBell"
                        aria-label="Notifications">
                        <i class="bi bi-bell fs-5"></i>
                        <span class="notification-badge" id="notificationDot"></span>
                    </button>

                    
                    <div class="dropdown">
                        <button class="user-avatar-btn border-0 d-flex align-items-center justify-content-center p-0"
                            id="userMenuDropdown" data-bs-toggle="dropdown" aria-expanded="false">
                            <img src="icons/contacts-icon.svg" class="avatar-icon" alt="User Profile Icon">
                        </button>
                        <div class="dropdown-menu user-profile-card dropdown-menu-end shadow border-0 p-0 overflow-hidden"
                            aria-labelledby="userMenuDropdown">
                            <div class="user-info-section p-3">
                                
                                <h6 class="user-name mb-1 fw-bold" id="dropdownUserName">
                                    <?= htmlspecialchars($_SESSION["full_name"], ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8") ?>
                                </h6>
                                
                                <span class="user-role small"
                                    id="dropdownUserRole"><?= htmlspecialchars($_SESSION["role_name"], ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8") ?></span>
                            </div>
                            <!-- Confirm logout before ending the session. -->
                            <a class="logout-action-btn d-flex align-items-center gap-3 text-decoration-none"
                                id="logoutBtn" href="#logoutConfirmationModal" data-bs-toggle="modal"
                                data-bs-target="#logoutConfirmationModal" role="button">
                                <img src="icons/leave-icon.svg" class="leave-icon" alt="Logout Icon">
                                <span class="logout-text fw-semibold">Logout</span>
                            </a>
                        </div>
                    </div>

                </div>
            </header>

            
            <main class="content-body p-3 p-md-4 flex-grow-1" id="mainContentArea">
                <!-- Page content is inserted here. -->
            </main>

        </div>

    </div>

    
    <div class="modal fade" id="logoutConfirmationModal" tabindex="-1" aria-labelledby="logoutConfirmationTitle"
        aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content border-0 rounded-4 shadow">

                
                <div class="modal-header border-0 pb-0">
                    <h5 class="modal-title fw-bold" id="logoutConfirmationTitle">
                        Confirm Logout
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>

                
                <div class="modal-body pt-3">
                    Are you sure you want to log out of your account?
                </div>

                
                <div class="modal-footer border-0 pt-0">
                    <button type="button" class="btn modal-btn-white px-4 py-2" data-bs-dismiss="modal">
                        Cancel
                    </button>

                    <a href="logout.php" id="logoutConfirmBtn" class="btn modal-btn-danger px-4 py-2">
                        Yes, Log Out
                    </a>
                </div>

            </div>
        </div>
    </div>

    
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="js-InAllPages/loading.js"></script>
    <script src="js-InAllPages/settings.js?v=3"></script>
    <script src="js-InAllPages/navbar.js?v=4"></script>
    <script src="js-InAllPages/pages.js?v=18"></script>
    <script src="js-InAllPages/notification.js"></script>

    <!-- Handle sidebar collapse state. -->
    <script>
        document.addEventListener("DOMContentLoaded", () => {
            const burgerToggle = document.getElementById("burgerToggle");
            const crmSidebar = document.getElementById("crmSidebar");

            // Restore the saved sidebar state.
            const isCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
            if (isCollapsed && crmSidebar) {
                crmSidebar.classList.add("collapsed");
                document.documentElement.classList.add("sidebar-is-collapsed");
            }

            if (burgerToggle && crmSidebar) {
                burgerToggle.addEventListener("click", () => {
                    crmSidebar.classList.toggle("collapsed");
                    const currentlyCollapsed = crmSidebar.classList.contains("collapsed");
                    localStorage.setItem("sidebarCollapsed", currentlyCollapsed);

                    if (currentlyCollapsed) {
                        document.documentElement.classList.add("sidebar-is-collapsed");
                    } else {
                        document.documentElement.classList.remove("sidebar-is-collapsed");
                    }
                });
            }
        });
    </script>
</body>

</html>