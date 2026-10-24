// Handle role-based navigation, page loading, and logout.
// Role-specific pages are mapped in CRM_ROLE_FILES below.
// Normalize the role names saved by the login flow.
function crmNormalizeRole(raw) {
  const r = String(raw || 'admin').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (r === 'cs' || r === 'cs staff' || r === 'customer service' || r === 'customer service staff') return 'customer service';
  if (r === 'sales' || r === 'sales staff') return 'sales staff';
  return r;
}

const CRM_ROLE = crmNormalizeRole(localStorage.getItem("userRole"));

// Add the role class used by CSS to control visibility.
document.documentElement.classList.add("role-" + CRM_ROLE.replace(/\s+/g, "-"));

// Map dashboard and report pages to their role-specific files.
const CRM_ROLE_FILES = {
  "admin":            { dashboard: "admindashboard.html",   reports: "reports.html" },
  "manager":          { dashboard: "managerDashboard.html", reports: "managerReports.html" },
  "customer service": { dashboard: "csDashboard.html",      reports: "csReports.html" },
  "sales staff":      { dashboard: "salesDashboard.html",   reports: "salesReports.html" }
};

// Convert a role-specific filename back to its shared page key.
function crmPageKey(url) {
  for (const role in CRM_ROLE_FILES) {
    for (const key in CRM_ROLE_FILES[role]) {
      if (CRM_ROLE_FILES[role][key] === url) return key;
    }
  }
  return url;
}

// Resolve a shared page key to this role's file.
function crmResolvePage(key) {
  const files = CRM_ROLE_FILES[CRM_ROLE] || {};
  return files[key] || key;
}

// Track known sidebar pages and those allowed for this role.
const crmKnownPages = new Set();
const crmAllowedPages = new Set();

// Show only sidebar items allowed for this role.
function crmApplyRoleToSidebar() {
  crmKnownPages.clear();
  crmAllowedPages.clear();

  document.querySelectorAll(".sidebar-nav .nav-item[data-role]").forEach((item) => {
    const roles = item.getAttribute("data-role").split(",").map((r) => crmNormalizeRole(r));
    const allowed = roles.includes("all") || roles.includes(CRM_ROLE);
    item.style.display = allowed ? "" : "none";

    const link = item.querySelector("a");
    const match = link ? (link.getAttribute("onclick") || "").match(/loadPage\('([^']+)'/) : null;
    if (match) {
      const key = crmPageKey(match[1]);
      crmKnownPages.add(key);
      if (allowed) crmAllowedPages.add(key);
    }
  });

  crmShowUserInfo();

  // Let CSS show role-dependent text after the role is applied.
  document.documentElement.classList.add("role-ready");
}

// Labels used in the sidebar and profile menu.
const CRM_ROLE_LABELS = {
  "admin": "Admin",
  "manager": "Manager",
  "customer service": "Customer Service",
  "sales staff": "Sales Staff"
};

// Fill the sidebar subtitle and profile details from local storage.
function crmShowUserInfo() {
  const label = CRM_ROLE_LABELS[CRM_ROLE] || CRM_ROLE.replace(/\b\w/g, (c) => c.toUpperCase());
  const name = (localStorage.getItem("userName") || "").trim() || label;

  const subtitle = document.querySelector(".brand-subtitle");
  if (subtitle) subtitle.textContent = label;

  const nameEl = document.getElementById("dropdownUserName");
  if (nameEl) nameEl.textContent = name;

  const roleEl = document.getElementById("dropdownUserRole");
  if (roleEl) roleEl.textContent = label;
}

// Apply the role immediately when the sidebar is already in the DOM.
if (document.getElementById("crmSidebar")) crmApplyRoleToSidebar();

// Handle logout, page links, and the initial page.
document.addEventListener("DOMContentLoaded", () => {
  const logoutConfirmBtn = document.getElementById("logoutConfirmBtn");

  // Clear locally stored user data when the user confirms logout.
  if (logoutConfirmBtn) {
    logoutConfirmBtn.addEventListener("click", () => {
      localStorage.removeItem("userRole");
      localStorage.removeItem("userName");
      localStorage.removeItem("userToken");
      localStorage.removeItem("activePage");
    });
  }

  // Keep links in the page area inside the application shell.
  document.addEventListener("click", (e) => {
    const link = e.target.closest("#mainContentArea a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || !href.endsWith(".html")) return;

    e.preventDefault();
    loadPage(href);
  });

  // Set allowed pages before applying the page guard.
  crmApplyRoleToSidebar();

  // Restore the last page, or open this role's dashboard.
  const activePage = localStorage.getItem("activePage") || "dashboard";
  loadPage(activePage);
});

// Load page content into the application shell.

// Fetch a page, then try the configured fallback if the request fails.
const PAGES_FOLDER = 'html-contentLoadsInNavbar/';
function crmFetchPage(file, fallback) {
  const fetchOptions = file === "settings.html" || file === "leadsanddeals.html" || file === "ticket.html"
    ? { cache: "no-store" }
    : undefined;
  return fetch(PAGES_FOLDER + file, fetchOptions)
    .then((response) => {
      if (!response.ok) throw new Error("Could not fetch page: " + file);
      return response.text();
    })
    .catch((error) => {
      if (fallback && fallback !== file) {
        console.warn(file + " was not found, showing " + fallback + " instead.");
        return crmFetchPage(fallback);
      }
      throw error;
    });
}

/**
 * Load a page into #mainContentArea and update the active sidebar link.
 * pageUrl may be a shared page key or a filename.
 */
function loadPage(pageUrl, clickedElement = null) {
  let key = crmPageKey(pageUrl);

  // Redirect to the dashboard if this role cannot open a known page.
  if (crmKnownPages.has(key) && !crmAllowedPages.has(key)) {
    key = "dashboard";
    clickedElement = null;
  }

  const file = crmResolvePage(key);
  const fallbackFile = key === "dashboard"
    ? null
    : (CRM_ROLE_FILES.admin && CRM_ROLE_FILES.admin[key]) || key;

  // Update the active sidebar link.
  const navLinks = document.querySelectorAll(".sidebar-nav .nav-link");
  navLinks.forEach((link) => {
    link.classList.remove("active");
    const onclickAttr = link.getAttribute("onclick") || "";
    if (clickedElement && link === clickedElement) {
      link.classList.add("active");
    } else if (!clickedElement && onclickAttr.includes("'" + key + "'")) {
      link.classList.add("active");
    }
  });

  // Save the shared key so it remains valid if the role changes.
  localStorage.setItem("activePage", key);

  // Fetch and render the page.
  crmFetchPage(file, fallbackFile)
    .then((html) => {
      const container = document.getElementById("mainContentArea");
      if (container) {
        // Keep shared styles and scripts in the authenticated app shell.
const doc = new DOMParser().parseFromString(html, "text/html");
doc.querySelectorAll("script, link").forEach((n) => n.remove());
container.innerHTML = doc.body.innerHTML;

        // Initialize page-specific behavior after inserting its markup.
        if (key === "settings.html" && typeof window.initCrmSettingsPage === "function") {
          window.initCrmSettingsPage();
        }
        // Render status badges if the helper is available.
        if (typeof renderStaticStatusBadges === "function") {
          renderStaticStatusBadges();
        }

        // Load page data and initialize table filters.
        if (typeof window.loadCrmPageData === "function") {
          window.loadCrmPageData();
        } else if (typeof window.initTableSearchAndFilters === "function") {
          window.initTableSearchAndFilters();
        }
      }
    })
    .catch((error) => {
      console.error("Error loading page:", error);
      const container = document.getElementById("mainContentArea");
      if (container) {
        container.innerHTML = `
          <div class="alert alert-danger" role="alert">
            This page could not be loaded. Refresh the application and try again.
          </div>`;
      }
    });
}