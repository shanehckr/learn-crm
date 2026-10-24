window.crmSelected = null; // Remember the selected record and its type.
function crmEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function crmFormatAmount(amount) {
  if (amount === null || amount === undefined || amount === "") return "—";
  const num = Number(amount);
  if (isNaN(num)) return crmEscape(amount);
  return (
    "₱ " +
    num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

function crmEmptyRow(colspan, message) {
  return `
    <tr class="empty-data-row">
      <td colspan="${colspan}" class="text-center py-5 text-muted fw-medium fs-6">${crmEscape(message)}</td>
    </tr>`;
}

function crmFormatPhone(raw) {
  let digits = String(raw || "")
    .replace(/^\s*\+63/, "")
    .replace(/\D/g, "");
  if (digits.length === 12 && digits.indexOf("63") === 0)
    digits = digits.slice(2);
  digits = digits.replace(/^0+/, "").slice(0, 10);
  return "+63 " + digits;
}

// Share lead stages across pages.
// Keep these names consistent with values stored by the API.
const CRM_LEAD_STAGES = [
  "New Inquiry",
  "In Progress",
  "In Discussion",
  "Declined",
];
const CRM_DEAL_STAGES = [
  "Quotation Preparation",
  "Quotation Sent",
  "Negotiation",
  "Confirmed",
  "Declined",
];

const CRM_STAGE_CLASS = {
  "new inquiry": "stage-new",
  "in progress": "stage-qualified",
  "in discussion": "stage-proposal",
  "quotation preparation": "stage-new",
  "quotation sent": "stage-proposal",
  negotiation: "stage-negotiation",
  confirmed: "stage-won",
  declined: "stage-loss",
  // Accept legacy stage names returned by the API.
  qualified: "stage-qualified",
  unqualified: "stage-loss",
  proposal: "stage-proposal",
  "closed won": "stage-won",
  "closed loss": "stage-loss",
};

// Initialize direct loads and pages inserted by navbar.js.
function crmEnsureEmptyMessage(tbody, colspan, message) {
  if (!tbody) return;
  const hasRows =
    tbody.querySelectorAll("tr:not(.empty-data-row):not(.no-results-row)")
      .length > 0;
  if (!hasRows) tbody.innerHTML = crmEmptyRow(colspan, message);
}

function crmSetDashboardDate() {
  const dateEl = document.getElementById("currentDashboardDate");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
}

// Scale each stage bar against the largest count.
function crmFillProgressBars() {
  document.querySelectorAll("ul.stage-list").forEach((list) => {
    const items = Array.from(list.querySelectorAll("li"));
    const counts = items.map((li) => {
      const c = li.querySelector(".stage-count");
      return c ? Number(c.textContent.trim()) || 0 : 0;
    });
    const max = Math.max(1, ...counts);
    items.forEach((li, i) => {
      const bar = li.querySelector(".progress-bar");
      if (bar) bar.style.width = (counts[i] / max) * 100 + "%";
    });
  });
}
window.crmFillProgressBars = crmFillProgressBars; // Call again after fetched data arrives.
function crmDashboardDate(value) {
  if (!value) return "—";
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function crmDashboardBadge(value, type) {
  const text = String(value ?? "");
  const key = text.toLowerCase();
  const classes = {
    open: "dashboard-badge--open",
    pending: "dashboard-badge--pending",
    resolved: "dashboard-badge--resolved",
    upcoming: "dashboard-badge--upcoming",
    "in progress": "dashboard-badge--pending",
    completed: "dashboard-badge--resolved",
    cancelled: "dashboard-badge--open",
    high: "dashboard-badge--open",
    medium: "dashboard-badge--pending",
    low: "dashboard-badge--resolved",
  };
  if (type === "stage") {
    const stageClass = CRM_STAGE_CLASS[key] || "stage-new";
    return `<span class="stage-pill ${stageClass}">${crmEscape(text)}</span>`;
  }
  return `<span class="crm-dashboard-badge ${classes[key] || ""}">${crmEscape(text || "—")}</span>`;
}
function crmDashboardRenderTable(root, name, rows, columns, emptyMessage) {
  const body = root.querySelector(`[data-dashboard-table="${name}"]`);
  if (!body) return;
  body.replaceChildren();
  if (!Array.isArray(rows) || rows.length === 0) {
    body.innerHTML = crmEmptyRow(columns.length, emptyMessage);
    return;
  }
  rows.forEach((record) => {
    const row = document.createElement("tr");
    columns.forEach((column) => {
      const cell = document.createElement("td");
      const value = record[column.key];
      if (column.type === "date") {
        cell.textContent = crmDashboardDate(value);
      } else if (column.type === "amount") {
        cell.textContent = crmFormatAmount(value);
      } else if (column.type === "ticket") {
        cell.textContent = `TKT-${String(value ?? "").padStart(4, "0")}`;
      } else if (column.type === "badge" || column.type === "stage") {
        cell.innerHTML = crmDashboardBadge(value, column.type);
      } else {
        cell.textContent =
          value === null || value === undefined || value === ""
            ? "—"
            : String(value);
      }
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

async function crmLoadRoleDashboard(root) {
  try {
    const response = await fetch("dashboard-api.php", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.metrics) {
      throw new Error(data.message || "Unable to load dashboard data.");
    }
    root.querySelectorAll("[data-metric]").forEach((element) => {
      const value = data.metrics[element.dataset.metric];
      element.textContent =
        value === undefined || value === null ? "0" : String(value);
    });
    root.querySelectorAll("[data-stage-group]").forEach((group) => {
      const groupName = group.dataset.stageGroup;
      const counts = data[groupName] || {};
      group.querySelectorAll("[data-stage-count]").forEach((element) => {
        const stage = element.dataset.stageCount;
        element.textContent = String(counts[stage] ?? 0);
      });
    });
    crmFillProgressBars();
    if (root.dataset.dashboardRole === "manager") {
      crmDashboardRenderTable(
        root,
        "upcoming_activities",
        data.upcoming_activities,
        [
          { key: "activity_name" },
          { key: "related_record" },
          { key: "assigned_staff" },
          { key: "due_date", type: "date" },
          { key: "status", type: "badge" },
        ],
        "No upcoming activities",
      );
      crmDashboardRenderTable(
        root,
        "confirmed_deals_list",
        data.confirmed_deals_list,
        [
          { key: "inquiry_event_name" },
          { key: "customer_name" },
          { key: "assigned_staff" },
          { key: "quotation_amount", type: "amount" },
          { key: "created_at", type: "date" },
        ],
        "No confirmed deals yet",
      );
    } else if (root.dataset.dashboardRole === "sales") {
      crmDashboardRenderTable(
        root,
        "upcoming_activities_list",
        data.upcoming_activities_list,
        [
          { key: "activity_name" },
          { key: "customer_name" },
          { key: "related_record" },
          { key: "activity_type", type: "badge" },
          { key: "due_date", type: "date" },
        ],
        "No upcoming activities",
      );
      crmDashboardRenderTable(
        root,
        "recent_records",
        data.recent_records,
        [
          { key: "record_name" },
          { key: "customer_name" },
          { key: "record_type", type: "badge" },
          { key: "current_stage", type: "stage" },
          { key: "updated_at", type: "date" },
        ],
        "No assigned records yet",
      );
    } else if (root.dataset.dashboardRole === "customer-service") {
      crmDashboardRenderTable(
        root,
        "ticket_overview",
        data.ticket_overview,
        [
          { key: "ticket_id", type: "ticket" },
          { key: "customer_name" },
          { key: "status", type: "badge" },
          { key: "priority", type: "badge" },
        ],
        "No assigned tickets",
      );
      crmDashboardRenderTable(
        root,
        "upcoming_followups_list",
        data.upcoming_followups_list,
        [
          { key: "customer_name" },
          { key: "activity_name" },
          { key: "due_date", type: "date" },
          { key: "status", type: "badge" },
        ],
        "No upcoming follow-ups",
      );
      crmDashboardRenderTable(
        root,
        "recent_tickets",
        data.recent_tickets,
        [
          { key: "ticket_id", type: "ticket" },
          { key: "customer_name" },
          { key: "subject" },
          { key: "status", type: "badge" },
          { key: "priority", type: "badge" },
          { key: "updated_at", type: "date" },
        ],
        "No assigned tickets",
      );
    }
  } catch (error) {
    console.error("Unable to load dashboard data:", error);
    root.querySelectorAll("[data-dashboard-table]").forEach((body) => {
      const table = body.closest("table");
      const columnCount = table ? table.querySelectorAll("thead th").length : 1;
      body.innerHTML = crmEmptyRow(
        columnCount,
        "Dashboard data is unavailable. Refresh to try again.",
      );
    });
    root.querySelectorAll("[data-metric]").forEach((element) => {
      element.textContent = "—";
    });
  }
}
// Save each dropdown's initial label for resets.
function crmInitModalDefaults() {
  document
    .querySelectorAll(".modal .custom-dropdown-toggle span")
    .forEach((span) => {
      if (span.dataset.defaultLabel === undefined) {
        span.dataset.defaultLabel = span.textContent.trim();
        span.dataset.wasMuted = span.classList.contains("text-muted")
          ? "1"
          : "0";
      }
    });
}
// Fill the stage menu only when the API left it empty.
function crmFillMenuIfEmpty(menuId, items, allLabel) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  if (menu.querySelector("li") && menu.dataset.auto !== "1") return; // Keep options supplied by the API.
  window.populateDropdown(menuId, items, allLabel);
  menu.dataset.auto = "1";
}

// Rebuild the stage filter when the selected type changes.
function crmUpdateStageFilter(typeValue) {
  const menu = document.getElementById("stagesFilterDropdown");
  if (!menu) return;
  const dropdown = menu.closest(".dropdown");
  const span = dropdown
    ? dropdown.querySelector(".custom-dropdown-toggle span")
    : null;
  if (span && !span.dataset.defaultLabel)
    span.dataset.defaultLabel = span.textContent.trim();
  const t = String(typeValue || "").toLowerCase();
  const toggle = dropdown
    ? dropdown.querySelector(".custom-dropdown-toggle")
    : null;
  const stages =
    t === "lead" ? CRM_LEAD_STAGES : t === "deal" ? CRM_DEAL_STAGES : [];
  window.populateDropdown("stagesFilterDropdown", stages, "All Stages");
  if (toggle) toggle.disabled = false;
  menu.dataset.auto = "1";
  // Reset the filter label and selection.
  if (span) span.textContent = span.dataset.defaultLabel;
  if (window.activeTableFilters) window.activeTableFilters.stage = "all";
}

window.loadCrmPageData = function () {
  const roleDashboard = document.querySelector("[data-crm-dashboard]");
  const contactsTable = document.getElementById("contactsTable");
  const leadsTable = document.getElementById("leadsDealsTable");
  const dashActivities = document.getElementById("upcomingActivitiesTable");
  const dashCustomers = document.getElementById("recentCustomersTable");
  const ticketsTable = document.getElementById("ticketsTable");
  const activitiesTable = document.getElementById("activitiesTable");

  renderStaticStatusBadges();
  crmInitModalDefaults();

  if (roleDashboard) {
    crmSetDashboardDate();
    crmLoadRoleDashboard(roleDashboard);
    return;
  } else if (contactsTable) {
    crmLoadContacts(contactsTable);
    return;
  } else if (leadsTable) {
    crmFillMenuIfEmpty("addLeadStageDropdown", CRM_LEAD_STAGES);
    crmFillMenuIfEmpty("addDealStageDropdown", CRM_DEAL_STAGES);
    crmFillMenuIfEmpty("editLeadDealStageDropdown", CRM_LEAD_STAGES);
    crmUpdateStageFilter("all"); // Wait for a type before showing stages.
    crmLoadLeads(leadsTable);
    return;
  } else if (ticketsTable) {
    crmRenderTicketBadges();
    crmLoadTickets(ticketsTable);
    return;
  } else if (activitiesTable) {
    crmLoadActivities(activitiesTable);
    return;
  } else if (dashActivities || dashCustomers) {
    crmSetDashboardDate();
    crmFillProgressBars();
    crmEnsureEmptyMessage(dashActivities, 5, "No upcoming activities");
    crmEnsureEmptyMessage(dashCustomers, 4, "No customers yet");
  }

  window.initTableSearchAndFilters();
};

async function crmLoadContacts(table) {
  const tbody = table.querySelector("tbody");
  if (!tbody || table.dataset.contactsLoading === "true") return;
  table.dataset.contactsLoading = "true";
  tbody.replaceChildren();
  crmAppendContactState(tbody, "Loading contacts...", "text-muted");
  try {
    const response = await fetch("contacts-api.php?action=list", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.contacts)) {
      throw new Error(data.message || "Unable to load contacts.");
    }
    tbody.replaceChildren();
    if (data.contacts.length === 0) {
      crmAppendContactState(tbody, "No contacts yet.", "text-muted");
    } else {
      const staffNames = new Set();
      data.contacts.forEach((contact) => {
        const row = document.createElement("tr");
        const assignedStaff = Array.isArray(contact.assigned_staff)
          ? contact.assigned_staff.filter(
              (staff) =>
                staff &&
                typeof staff.full_name === "string" &&
                staff.full_name.trim(),
            )
          : [];
        const names = assignedStaff.map((staff) => staff.full_name.trim());
        row.dataset.id = String(contact.contact_id ?? "");
        row.dataset.email =
          typeof contact.email === "string" ? contact.email : "";
        row.dataset.phone =
          typeof contact.contact_number === "string"
            ? contact.contact_number
            : "";
        row.dataset.staffNames = JSON.stringify(
          names.map((name) => name.toLowerCase()),
        );
        const nameCell = document.createElement("td");
        nameCell.className = "fw-semibold";
        nameCell.textContent = contact.customer_name ?? "";
        const emailCell = document.createElement("td");
        emailCell.textContent = contact.email ?? "";
        const phoneCell = document.createElement("td");
        phoneCell.textContent = contact.contact_number ?? "";
        const staffCell = document.createElement("td");
        staffCell.textContent = names.join(", ") || "—";
        names.forEach((name) => staffNames.add(name));
        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "d-flex align-items-center gap-3";
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className =
          "btn btn-link p-0 text-decoration-none action-btn-edit";
        editButton.dataset.bsToggle = "modal";
        editButton.dataset.bsTarget = "#editCustomerModal";
        editButton.textContent = "Edit";
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className =
          "btn btn-link p-0 text-decoration-none action-btn-delete";
        deleteButton.dataset.bsToggle = "modal";
        deleteButton.dataset.bsTarget = "#deleteContactModal";
        deleteButton.textContent = "Delete";
        actions.append(editButton, deleteButton);
        actionsCell.append(actions);
        row.append(nameCell, emailCell, phoneCell, staffCell, actionsCell);
        tbody.append(row);
      });
      crmPopulateContactStaffFilter(staffNames);
    }
    if (document.getElementById("contactsTable") === table) {
      window.initTableSearchAndFilters();
    }
  } catch (error) {
    console.error("Contacts loading failed:", error);
    tbody.replaceChildren();
    crmAppendContactState(
      tbody,
      "Unable to load contacts. Refresh the page and try again.",
      "text-danger",
    );
    if (document.getElementById("contactsTable") === table) {
      window.initTableSearchAndFilters();
    }
  } finally {
    delete table.dataset.contactsLoading;
  }
}
function crmAppendContactState(tbody, message, textClass) {
  const row = document.createElement("tr");
  row.className = "empty-data-row";
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.className = `text-center py-4 ${textClass}`;
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
}
function crmPopulateContactStaffFilter(staffNames) {
  const menu = document.getElementById("staffFilterDropdownList");
  if (!menu) return;
  menu.replaceChildren();
  [
    "All Staff",
    ...Array.from(staffNames).sort((a, b) => a.localeCompare(b)),
  ].forEach((name) => {
    const item = document.createElement("a");
    item.className = "dropdown-item custom-dropdown-item py-2 px-3";
    item.href = "#";
    item.textContent = name;
    const listItem = document.createElement("li");
    listItem.append(item);
    menu.append(listItem);
  });
}
function crmSetDropdownState(menuId, message) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  menu.replaceChildren();
  crmAppendDropdownState(menu, message);
}
function crmAppendDropdownState(menu, message) {
  const item = document.createElement("span");
  item.className = "dropdown-item custom-dropdown-item py-2 px-3 text-muted";
  item.textContent = message;
  item.dataset.dropdownState = "true";
  item.setAttribute("aria-disabled", "true");
  const row = document.createElement("li");
  row.append(item);
  menu.append(row);
}
function crmPopulateDealDropdowns(data) {
  const contacts = data.contacts.map((contact) => {
    const customerName = String(contact.customer_name || "");
    return {
      value: contact.contact_id,
      text: customerName,
      name: customerName,
    };
  });
  window.populateDropdown("addDealCustomerDropdown", contacts);
  const customerToggle = document.querySelector(
    '#addDealModal .dropdown[data-field="customer_id"] .custom-dropdown-toggle',
  );
  if (customerToggle) customerToggle.disabled = false;
  const existingDealLeadIds = new Set(
    data.deals.map((deal) => String(deal.lead_id)),
  );
  const availableLeads = data.leads
    .filter((lead) => !existingDealLeadIds.has(String(lead.lead_id)))
    .map((lead) => ({
      value: lead.lead_id,
      customerId: lead.contact_id,
      text: lead.inquiry_event_name || `Lead ${lead.lead_id}`,
    }));
  window.populateDropdown("addDealRelatedLeadDropdown", availableLeads);
  if (availableLeads.length === 0) {
    crmSetDropdownState(
      "addDealRelatedLeadDropdown",
      "No Leads are available for new Deals.",
    );
  }
}
async function crmLoadLeads(table) {
  const tbody = table.querySelector("tbody");
  if (!tbody || table.dataset.leadsLoading === "true") return;
  table.dataset.leadsLoading = "true";
  tbody.replaceChildren();
  crmAppendLeadState(tbody, "Loading leads...", "text-muted");
  try {
    const response = await fetch("leads-api.php?action=list", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json();
    const validId = (value) => /^[1-9][0-9]*$/.test(String(value));
    const validContact = (contact) =>
      contact &&
      typeof contact === "object" &&
      validId(contact.contact_id) &&
      typeof contact.customer_name === "string";
    const validLead = (lead) =>
      lead &&
      typeof lead === "object" &&
      validId(lead.lead_id) &&
      validId(lead.contact_id);
    const validDeal = (deal) =>
      deal && typeof deal === "object" && validId(deal.lead_id);
    const errorMessage =
      data && typeof data.message === "string"
        ? data.message
        : "The server returned an invalid customer list.";
    if (
      !response.ok ||
      !data ||
      typeof data !== "object" ||
      !data.success ||
      !Array.isArray(data.leads) ||
      !data.leads.every(validLead) ||
      !Array.isArray(data.deals) ||
      !data.deals.every(validDeal) ||
      !Array.isArray(data.contacts) ||
      !data.contacts.every(validContact) ||
      !Array.isArray(data.staff) ||
      !["Admin", "Manager", "Sales Staff"].includes(data.role) ||
      typeof data.csrf_token !== "string" ||
      data.csrf_token === ""
    ) {
      throw new Error(errorMessage || "Unable to load leads.");
    }
    if (document.getElementById("leadsDealsTable") !== table) return;
    table.dataset.csrfToken = data.csrf_token || "";
    table.dataset.currentRole = data.role || "";
    window.crmLeadStaff = Array.isArray(data.staff)
      ? data.staff.filter(
          (staff) =>
            staff &&
            staff.status === "Active" &&
            staff.role_name === "Sales Staff",
        )
      : [];
    const customerOptions = Array.isArray(data.contacts)
      ? data.contacts.map((contact) => ({
          value: contact.contact_id,
          text: contact.customer_name || "",
          email: contact.email || "",
          phone: contact.contact_number || "",
        }))
      : [];
    window.populateDropdown("addLeadCustomerDropdown", customerOptions);
    crmPopulateDealDropdowns(data);
    const addDealButton = document.querySelector(
      '[data-bs-target="#addDealModal"]',
    );
    if (addDealButton) addDealButton.hidden = false;
    const staffOptions = window.crmLeadStaff.map((staff) => ({
      value: staff.user_id,
      text: staff.full_name || "",
    }));
    window.populateDropdown("addLeadStaffDropdown", staffOptions);
    window.populateDropdown("addDealStaffDropdown", staffOptions);
    window.populateDropdown("editLeadDealStaffDropdown", [
      { value: "", text: "Unassigned" },
      ...staffOptions,
    ]);
    const addStaffDropdown = document.querySelector(
      '#addLeadModal .dropdown[data-field="staff_id"]',
    );
    const addStaffToggle =
      addStaffDropdown &&
      addStaffDropdown.querySelector(".custom-dropdown-toggle");
    const addDealStaffDropdown = document.querySelector(
      '#addDealModal .dropdown[data-field="staff_id"]',
    );
    const addDealStaffToggle =
      addDealStaffDropdown &&
      addDealStaffDropdown.querySelector(".custom-dropdown-toggle");
    if (data.role === "Sales Staff") {
      const currentStaff = window.crmLeadStaff.find(
        (staff) => String(staff.user_id) === String(data.user_id),
      );
      if (addStaffToggle) addStaffToggle.disabled = true;
      if (addDealStaffToggle) addDealStaffToggle.disabled = true;
      if (currentStaff) {
        crmSelectDropdown(
          addStaffDropdown,
          currentStaff.full_name,
          currentStaff.user_id,
        );
        crmSelectDropdown(
          addDealStaffDropdown,
          currentStaff.full_name,
          currentStaff.user_id,
        );
      }
      const addLeadModal = document.getElementById("addLeadModal");
      if (
        addLeadModal &&
        addLeadModal.dataset.salesAssignmentBound !== "true"
      ) {
        addLeadModal.dataset.salesAssignmentBound = "true";
        addLeadModal.addEventListener("shown.bs.modal", () => {
          const latestStaff = (window.crmLeadStaff || []).find(
            (staff) => String(staff.user_id) === String(data.user_id),
          );
          if (latestStaff) {
            crmSelectDropdown(
              addStaffDropdown,
              latestStaff.full_name,
              latestStaff.user_id,
            );
          }
        });
      }
      const addDealModal = document.getElementById("addDealModal");
      if (
        addDealModal &&
        addDealModal.dataset.salesAssignmentBound !== "true"
      ) {
        addDealModal.dataset.salesAssignmentBound = "true";
        addDealModal.addEventListener("shown.bs.modal", () => {
          const latestStaff = (window.crmLeadStaff || []).find(
            (staff) => String(staff.user_id) === String(data.user_id),
          );
          if (latestStaff) {
            crmSelectDropdown(
              addDealStaffDropdown,
              latestStaff.full_name,
              latestStaff.user_id,
            );
          }
        });
      }
    } else {
      if (addStaffToggle) addStaffToggle.disabled = false;
      if (addDealStaffToggle) addDealStaffToggle.disabled = false;
    }
    tbody.replaceChildren();
    const records = [
      ...data.leads.map((lead) => ({
        ...lead,
        record_id: lead.lead_id,
        record_type: "lead",
      })),
      ...data.deals.map((deal) => ({
        ...deal,
        record_id: deal.deal_id,
        record_type: "deal",
      })),
    ];
    if (records.length === 0) {
      crmAppendLeadState(tbody, "No leads or deals yet.", "text-muted");
    } else {
      records.forEach((record) => {
        const isDeal = record.record_type === "deal";
        const row = document.createElement("tr");
        row.dataset.id = String(record.record_id ?? "");
        row.dataset.recordType = record.record_type;
        row.dataset.staffId =
          record.assigned_user_id === null
            ? ""
            : String(record.assigned_user_id);
        row.dataset.staffName = record.assigned_staff_name || "";
        row.dataset.staffRole = record.assigned_staff_role || "";
        row.dataset.staffStatus = record.assigned_staff_status || "";
        row.dataset.contactId = String(record.contact_id ?? "");
        row.dataset.customerEmail = record.customer_email || "";
        row.dataset.customerPhone = record.customer_phone || "";
        const eventCell = document.createElement("td");
        eventCell.className = "fw-semibold";
        eventCell.textContent = record.inquiry_event_name ?? "";
        const customerCell = document.createElement("td");
        customerCell.textContent = record.customer_name ?? "";
        const typeCell = document.createElement("td");
        const typeBadge = document.createElement("span");
        typeBadge.className = `type-pill ${isDeal ? "type-deal" : "type-lead"}`;
        typeBadge.textContent = isDeal ? "Deal" : "Lead";
        typeCell.append(typeBadge);
        const stageCell = document.createElement("td");
        const stageBadge = document.createElement("span");
        const normalizedStage = String(record.stage || "").toLowerCase();
        stageBadge.className = `stage-pill ${CRM_STAGE_CLASS[normalizedStage] || "stage-new"}`;
        stageBadge.textContent = record.stage ?? "";
        stageCell.append(stageBadge);
        const staffCell = document.createElement("td");
        const staffName = record.assigned_staff_name || "Unassigned";
        staffCell.textContent = staffName;
        const assignmentNeedsCorrection =
          record.assigned_user_id !== null &&
          (record.assigned_staff_status !== "Active" ||
            record.assigned_staff_role !== "Sales Staff");
        if (assignmentNeedsCorrection) {
          const warning = document.createElement("span");
          warning.className = "badge text-bg-warning ms-2";
          warning.textContent = "Needs correction";
          warning.title = "Assigned user must be active Sales Staff.";
          staffCell.append(warning);
          row.dataset.assignmentNeedsCorrection = "true";
        } else {
          row.dataset.assignmentNeedsCorrection = "false";
        }
        const amountCell = document.createElement("td");
        amountCell.className = "fw-bold";
        amountCell.textContent = crmFormatAmount(
          isDeal ? record.quotation_amount : null,
        );
        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "d-flex align-items-center gap-3";
        const recordActions = [
          ["View", "action-btn-view", "#viewLeadDealModal"],
          ["Edit", "action-btn-edit", "#editLeadDealModal"],
        ];
        if (data.role === "Admin") {
          recordActions.push([
            "Delete",
            "action-btn-delete",
            "#deleteDealModal",
          ]);
        }
        recordActions.forEach(([label, actionClass, target]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `btn btn-link p-0 text-decoration-none ${actionClass}`;
          button.dataset.bsToggle = "modal";
          button.dataset.bsTarget = target;
          button.textContent = label;
          actions.append(button);
        });
        actionsCell.append(actions);
        row.append(
          eventCell,
          customerCell,
          typeCell,
          stageCell,
          staffCell,
          amountCell,
          actionsCell,
        );
        tbody.append(row);
      });
    }
    if (document.getElementById("leadsDealsTable") === table) {
      window.initTableSearchAndFilters();
    }
  } catch (error) {
    console.error("Lead loading failed:", error);
    tbody.replaceChildren();
    crmAppendLeadState(
      tbody,
      "Unable to load leads. Refresh the page and try again.",
      "text-danger",
    );
    if (document.getElementById("leadsDealsTable") === table) {
      window.initTableSearchAndFilters();
    }
  } finally {
    delete table.dataset.leadsLoading;
  }
}
function crmAppendLeadState(tbody, message, textClass) {
  const row = document.createElement("tr");
  row.className = "empty-data-row";
  const cell = document.createElement("td");
  cell.colSpan = 7;
  cell.className = `text-center py-4 ${textClass}`;
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
}
async function crmLoadTickets(table) {
  const tbody = table.querySelector("tbody");
  if (!tbody || table.dataset.ticketsLoading === "true") return;
  table.dataset.ticketsLoading = "true";
  tbody.replaceChildren();
  crmAppendTicketState(tbody, "Loading tickets...", "text-muted");
  try {
    const response = await fetch("tickets-api.php?action=list", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json();
    if (
      !response.ok ||
      !data.success ||
      !Array.isArray(data.tickets) ||
      !Array.isArray(data.contacts) ||
      !Array.isArray(data.staff) ||
      typeof data.csrf_token !== "string" ||
      data.csrf_token === ""
    ) {
      throw new Error(data.message || "Unable to load tickets.");
    }
    if (document.getElementById("ticketsTable") !== table) return;
    table.dataset.csrfToken = data.csrf_token;
    table.dataset.currentRole = data.role || "";
    window.crmTicketStaff = data.staff;
    const contactOptions = data.contacts.map((contact) => ({
      value: contact.contact_id,
      text: contact.customer_name || "",
    }));
    const staffOptions = data.staff.map((staff) => ({
      value: staff.user_id,
      text: staff.full_name || "",
    }));
    window.populateDropdown("addTicketCustomerDropdown", contactOptions);
    window.populateDropdown("addTicketStaffDropdown", staffOptions);
    window.populateDropdown("editTicketStaffDropdown", staffOptions);
    tbody.replaceChildren();
    if (data.tickets.length === 0) {
      crmAppendTicketState(tbody, "No tickets yet.", "text-muted");
    } else {
      data.tickets.forEach((ticket) => {
        const row = document.createElement("tr");
        row.dataset.id = String(ticket.ticket_id ?? "");
        row.dataset.customerId = String(ticket.contact_id ?? "");
        row.dataset.staffId = String(ticket.assigned_user_id ?? "");
        row.dataset.desc = ticket.description || "";
        const ticketNoCell = document.createElement("td");
        ticketNoCell.textContent = `TKT-${String(ticket.ticket_id).padStart(4, "0")}`;
        const nameCell = document.createElement("td");
        nameCell.className = "fw-semibold";
        nameCell.textContent = ticket.ticket_name || "";
        const customerCell = document.createElement("td");
        customerCell.textContent = ticket.customer_name || "";
        const statusCell = document.createElement("td");
        statusCell.dataset.ticketStatus = ticket.status || "";
        statusCell.textContent = ticket.status || "";
        const priorityCell = document.createElement("td");
        priorityCell.dataset.ticketPriority = ticket.priority || "";
        priorityCell.textContent = ticket.priority || "";
        const staffCell = document.createElement("td");
        staffCell.textContent = ticket.assigned_staff_name || "";
        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "d-flex align-items-center gap-3";
        [
          ["Edit", "action-btn-edit", "#editTicketModal"],
          ["View", "action-btn-view", "#viewTicketModal"],
        ].forEach(([label, actionClass, target]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `btn btn-link p-0 text-decoration-none ${actionClass}`;
          button.dataset.bsToggle = "modal";
          button.dataset.bsTarget = target;
          button.textContent = label;
          actions.append(button);
        });
        if (data.role === "Admin") {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className =
            "btn btn-link p-0 text-decoration-none action-btn-delete";
          deleteButton.textContent = "Delete";
          actions.append(deleteButton);
        }
        actionsCell.append(actions);
        row.append(
          ticketNoCell,
          nameCell,
          customerCell,
          statusCell,
          priorityCell,
          staffCell,
          actionsCell,
        );
        tbody.append(row);
      });
      crmRenderTicketBadges();
    }
    if (document.getElementById("ticketsTable") === table) {
      window.initTableSearchAndFilters();
    }
  } catch (error) {
    console.error("Ticket loading failed:", error);
    tbody.replaceChildren();
    crmAppendTicketState(
      tbody,
      error.message ||
        "Unable to load tickets. Refresh the page and try again.",
      "text-danger",
    );
    if (document.getElementById("ticketsTable") === table) {
      window.initTableSearchAndFilters();
    }
  } finally {
    delete table.dataset.ticketsLoading;
  }
}
function crmAppendTicketState(tbody, message, textClass) {
  const row = document.createElement("tr");
  row.className = "empty-data-row";
  const cell = document.createElement("td");
  cell.colSpan = 7;
  cell.className = `text-center py-4 ${textClass}`;
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
}
function crmShowLeadNotice(message, type) {
  const table = document.getElementById("leadsDealsTable");
  const main = table && table.closest("main");
  if (!main) return;
  let notice = main.querySelector(".leads-api-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "leads-api-notice alert d-none";
    notice.setAttribute("role", "alert");
    const card = table.closest(".card");
    if (card) main.insertBefore(notice, card);
  }
  notice.className = `leads-api-notice alert alert-${type}`;
  notice.textContent = message;
}
function crmShowLeadFormMessage(form, message, type) {
  let notice = form.parentElement.querySelector(".lead-api-form-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "lead-api-form-notice alert mb-3";
    notice.setAttribute("role", "alert");
    form.parentElement.insertBefore(notice, form);
  }
  notice.className = `lead-api-form-notice alert alert-${type} mb-3`;
  notice.textContent = message;
}
async function crmRefreshLeadCsrfToken(table) {
  const response = await fetch("leads-api.php?action=list", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json();
  if (response.status === 401 || data.code === "session_expired") {
    throw new Error(
      "Your session has expired. Log in again, then reopen Leads & Deals.",
    );
  }
  if (
    !response.ok ||
    !data.success ||
    typeof data.csrf_token !== "string" ||
    data.csrf_token === ""
  ) {
    throw new Error(
      data.message ||
        "Unable to verify your session. Refresh Leads & Deals and try again.",
    );
  }
  table.dataset.csrfToken = data.csrf_token;
  return data.csrf_token;
}
async function crmSendLeadAction(action, form, table) {
  const sendRequest = () => {
    const csrfToken = table.dataset.csrfToken || "";
    const formData = new FormData(form);
    formData.set("csrf_token", csrfToken);
    return fetch(`leads-api.php?action=${encodeURIComponent(action)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: formData,
    });
  };
  await crmRefreshLeadCsrfToken(table);
  let response = await sendRequest();
  let data = await response.json();
  if (response.status === 403 && data.code === "csrf_invalid") {
    await crmRefreshLeadCsrfToken(table);
    response = await sendRequest();
    data = await response.json();
  }
  return { response, data };
}
async function crmRefreshDealDropdowns(modal) {
  const table = document.getElementById("leadsDealsTable");
  const form = modal.querySelector("#addDealForm");
  const customerToggle = modal.querySelector(
    '.dropdown[data-field="customer_id"] .custom-dropdown-toggle',
  );
  const leadToggle = modal.querySelector(
    '.dropdown[data-field="related_lead_id"] .custom-dropdown-toggle',
  );
  if (!table || !form || !customerToggle || !leadToggle) return;
  customerToggle.disabled = true;
  leadToggle.disabled = true;
  crmShowLeadFormMessage(
    form,
    "Loading customers and available Leads...",
    "info",
  );
  crmSetDropdownState("addDealCustomerDropdown", "Loading customers...");
  crmSetDropdownState(
    "addDealRelatedLeadDropdown",
    "Loading available Leads...",
  );
  try {
    const response = await fetch("leads-api.php?action=list", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The server returned an invalid customer response.");
    }
    const validId = (value) => /^[1-9][0-9]*$/.test(String(value));
    const validContact = (contact) =>
      contact &&
      typeof contact === "object" &&
      validId(contact.contact_id) &&
      typeof contact.customer_name === "string";
    const validLead = (lead) =>
      lead &&
      typeof lead === "object" &&
      validId(lead.lead_id) &&
      validId(lead.contact_id);
    const validDeal = (deal) =>
      deal && typeof deal === "object" && validId(deal.lead_id);
    const errorMessage =
      data && typeof data.message === "string"
        ? data.message
        : "The server returned an invalid customer list.";
    if (
      !response.ok ||
      !data ||
      typeof data !== "object" ||
      !data.success ||
      !["Admin", "Manager", "Sales Staff"].includes(data.role) ||
      !Array.isArray(data.contacts) ||
      !data.contacts.every(validContact) ||
      !Array.isArray(data.leads) ||
      !data.leads.every(validLead) ||
      !Array.isArray(data.deals) ||
      !data.deals.every(validDeal) ||
      typeof data.csrf_token !== "string" ||
      data.csrf_token === ""
    ) {
      throw new Error(errorMessage);
    }
    if (document.getElementById("addDealModal") !== modal) return;
    table.dataset.csrfToken = data.csrf_token;
    crmPopulateDealDropdowns(data);
    const notice = form.parentElement.querySelector(".lead-api-form-notice");
    if (notice) notice.remove();
    const availableLeadCount = data.leads.filter(
      (lead) =>
        !data.deals.some(
          (deal) => String(deal.lead_id) === String(lead.lead_id),
        ),
    ).length;
    if (data.contacts.length === 0 || availableLeadCount === 0) {
      crmShowLeadFormMessage(
        form,
        data.contacts.length === 0
          ? "No Contacts are currently available to your account."
          : "No available Lead can be selected for a new Deal.",
        "warning",
      );
    }
  } catch (error) {
    console.error("Deal customer refresh failed:", error);
    crmSetDropdownState(
      "addDealCustomerDropdown",
      "Unable to load customers. Reopen this form to try again.",
    );
    crmSetDropdownState(
      "addDealRelatedLeadDropdown",
      "Unable to load available Leads.",
    );
    customerToggle.disabled = true;
    leadToggle.disabled = true;
    crmShowLeadFormMessage(
      form,
      error.message ||
        "Unable to load customers. Reopen this form to try again.",
      "danger",
    );
  }
}
if (!window.__crmLeadFormsBound) {
  window.__crmLeadFormsBound = true;
  document.addEventListener("shown.bs.modal", (event) => {
    event.target
      .querySelectorAll(".lead-api-form-notice")
      .forEach((notice) => notice.remove());
    if (event.target.id === "addDealModal") {
      crmRefreshDealDropdowns(event.target);
    }
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    const formId = form && form.getAttribute("id");
    if (
      ![
        "addLeadForm",
        "addDealForm",
        "editLeadDealForm",
        "deleteLeadDealForm",
      ].includes(formId)
    )
      return;
    if (form.dataset.submitting === "true") {
      event.preventDefault();
      return;
    }
    const actionByFormId = {
      addLeadForm: "create",
      addDealForm: "create-deal",
      editLeadDealForm: "update",
      deleteLeadDealForm: "delete",
    };
    const action = actionByFormId[formId];
    const leadsTable = document.getElementById("leadsDealsTable");
    if (!leadsTable) return;
    if (formId === "editLeadDealForm" || formId === "deleteLeadDealForm") {
      const selectedType =
        window.crmSelected && window.crmSelected.item
          ? String(window.crmSelected.item.type || "")
              .trim()
              .toLowerCase()
          : "";
      if (!["lead", "deal"].includes(selectedType)) {
        event.preventDefault();
        crmShowLeadFormMessage(
          form,
          "Select a Lead or Deal before submitting this form.",
          "warning",
        );
        return;
      }
    }
    if (
      formId === "addDealForm" &&
      Array.from(form.querySelectorAll('.dropdown[data-required="true"]')).some(
        (dropdown) => {
          const hidden = dropdown.querySelector('input[type="hidden"]');
          const missing = !hidden || hidden.value === "";
          const toggle = dropdown.querySelector(".custom-dropdown-toggle");
          if (toggle) toggle.classList.toggle("dd-invalid", missing);
          return missing;
        },
      )
    ) {
      event.preventDefault();
      crmShowLeadFormMessage(
        form,
        "Select a customer, a matching Lead, a Deal stage, an assigned staff member, and a service arrangement.",
        "warning",
      );
      return;
    }
    if (formId === "addDealForm") {
      const customerDropdown = form.querySelector(
        '.dropdown[data-field="customer_id"]',
      );
      const customerChoice =
        customerDropdown &&
        customerDropdown.querySelector('input[type="hidden"]');
      if (customerChoice && customerChoice.value === "new") {
        const emailField = form.querySelector('[name="customer_email"]');
        const phoneField = form.querySelector('[name="customer_phone"]');
        const email = emailField ? emailField.value.trim() : "";
        const phone = phoneField ? phoneField.value.trim() : "";
        const phoneDigits = phone.replace(/\D/g, "");
        if (
          (!email && phoneDigits.length < 7) ||
          (phone && (phoneDigits.length < 7 || phoneDigits.length > 15)) ||
          (email && emailField && !emailField.checkValidity())
        ) {
          event.preventDefault();
          crmShowLeadFormMessage(
            form,
            "For a new customer, provide a valid email address or contact number. Any entered email or phone must be valid.",
            "warning",
          );
          return;
        }
      }
    }
    event.preventDefault();
    form.dataset.submitting = "true";
    const submitButton =
      document.querySelector(`[form="${formId}"][type="submit"]`) ||
      form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    const oldMessage = form.parentElement.querySelector(
      ".lead-api-form-notice",
    );
    if (oldMessage) oldMessage.remove();
    try {
      const { response, data } = await crmSendLeadAction(
        action,
        form,
        leadsTable,
      );
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to save this record.");
      }
      if (document.getElementById("leadsDealsTable") !== leadsTable) return;
      const modal = form.closest(".modal");
      if (modal && window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modal).hide();
      }
      crmShowLeadNotice(data.message || "Lead operation completed.", "success");
      await crmLoadLeads(leadsTable);
    } catch (error) {
      console.error(
        `${formId === "addDealForm" ? "Deal" : "Lead"} operation failed:`,
        error,
      );
      crmShowLeadFormMessage(
        form,
        error.message || "Unable to process this Lead. Please try again.",
        "danger",
      );
    } finally {
      delete form.dataset.submitting;
      if (submitButton) submitButton.disabled = false;
    }
  });
}
// Custom dropdown helpers.
function crmSetHidden(dropdown, value) {
  const field = dropdown.getAttribute("data-field");
  if (!field) return;
  let hidden = dropdown.querySelector('input[type="hidden"]');
  if (!hidden) {
    hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = field;
    dropdown.appendChild(hidden);
  }
  hidden.value = value;
}

// Select a modal option by ID or visible text.
function crmSelectDropdown(dropdown, text, valueHint) {
  if (!dropdown) return;
  const span = dropdown.querySelector(".custom-dropdown-toggle span");
  const items = Array.from(dropdown.querySelectorAll(".custom-dropdown-item"));
  let match = null;
  if (valueHint)
    match = items.find(
      (a) => a.getAttribute("data-value") === String(valueHint),
    );
  if (!match && text) {
    const wanted = String(text).trim().toLowerCase();
    match = items.find((a) => a.textContent.trim().toLowerCase() === wanted);
  }
  const label = match ? match.textContent.trim() : text || "";
  if (span) {
    span.textContent = label || span.dataset.defaultLabel || "Select";
    span.classList.toggle("text-muted", !label);
  }
  const v = match ? match.getAttribute("data-value") : null;
  crmSetHidden(dropdown, v !== null ? v : label);
  const toggle = dropdown.querySelector(".custom-dropdown-toggle");
  if (toggle) toggle.classList.remove("dd-invalid");
}

// Build dropdown items from text or option objects.
window.populateDropdown = function (menuId, items, allLabel) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const list = (allLabel ? [allLabel] : []).concat(items || []);
  menu.innerHTML = list
    .map((it) => {
      const o = it && typeof it === "object" ? it : { text: it };
      const v =
        o.value !== undefined ? ' data-value="' + crmEscape(o.value) + '"' : "";
      const c =
        o.customerId !== undefined
          ? ' data-customer-id="' + crmEscape(o.customerId) + '"'
          : "";
      const em =
        o.email !== undefined ? ' data-email="' + crmEscape(o.email) + '"' : "";
      const ph =
        o.phone !== undefined ? ' data-phone="' + crmEscape(o.phone) + '"' : "";
      const name =
        o.name !== undefined ? ' data-name="' + crmEscape(o.name) + '"' : "";
      return (
        '<li><a class="dropdown-item custom-dropdown-item py-2 px-3" href="#"' +
        v +
        c +
        em +
        ph +
        name +
        ">" +
        crmEscape(o.text) +
        "</a></li>"
      );
    })
    .join("");
};

// Filter the Add Deal lead list by the selected customer.
// Related lead options must include the lead and customer IDs.
function crmFilterRelatedLeads(customerId) {
  const dd = document.querySelector(
    '#addDealModal .dropdown[data-field="related_lead_id"]',
  );
  if (!dd) return;
  const toggle = dd.querySelector(".custom-dropdown-toggle");
  const span = toggle.querySelector("span");
  const menu = dd.querySelector(".custom-dropdown-menu");
  menu.querySelectorAll('[data-dropdown-state="true"]').forEach((item) => {
    const row = item.closest("li");
    if (row) row.remove();
  });
  if (String(customerId) === "new") {
    menu.querySelectorAll("li").forEach((li) => {
      li.style.display = "none";
    });
    crmSetHidden(dd, "");
    toggle.disabled = true;
    span.textContent = "New Lead will be created";
    span.classList.add("text-muted");
    return;
  }
  let shown = 0;
  menu.querySelectorAll("li").forEach((li) => {
    const a = li.querySelector("a");
    if (!a) return;
    const match = a.getAttribute("data-customer-id") === String(customerId);
    li.style.display = match ? "" : "none";
    if (match) shown++;
  });
  crmSetHidden(dd, "");
  toggle.disabled = !customerId;
  span.textContent = shown
    ? "Select related Lead"
    : "No available Leads for this customer";
  span.classList.add("text-muted");
  if (shown === 0) {
    crmAppendDropdownState(menu, "No available Leads for this customer.");
  }
}

function crmSetDealCustomerMode(modal, isNewCustomer) {
  ["customer_name", "customer_email", "customer_phone"].forEach((name) => {
    const field = modal.querySelector(`[name="${name}"]`);
    if (!field) return;
    field.readOnly = !isNewCustomer;
    field.required = isNewCustomer && name === "customer_name";
    if (isNewCustomer) field.value = "";
  });
  const relatedDropdown = modal.querySelector(
    '.dropdown[data-field="related_lead_id"]',
  );
  const relatedToggle =
    relatedDropdown && relatedDropdown.querySelector(".custom-dropdown-toggle");
  const relatedLabel = modal.querySelector("#addDealRelatedLeadHelp");
  const customerHidden = modal.querySelector(
    '.dropdown[data-field="customer_id"] input[type="hidden"]',
  );
  if (relatedDropdown) {
    relatedDropdown.dataset.required = isNewCustomer ? "false" : "true";
    crmSetHidden(relatedDropdown, "");
  }
  if (relatedToggle) {
    relatedToggle.disabled =
      isNewCustomer || !customerHidden || !customerHidden.value;
    const span = relatedToggle.querySelector("span");
    if (span) {
      span.textContent = isNewCustomer
        ? "New Lead will be created"
        : "Select a customer first";
      span.classList.add("text-muted");
    }
  }
  if (relatedLabel) {
    relatedLabel.textContent = isNewCustomer
      ? "A new Lead will be created for this customer."
      : "Choose a Lead belonging to the selected customer.";
  }
  const relatedRequired = modal.querySelector("#addDealLeadRequired");
  if (relatedRequired)
    relatedRequired.classList.toggle("d-none", isNewCustomer);
  const customerNameRequired = modal.querySelector(
    "#addDealCustomerNameRequired",
  );
  if (customerNameRequired)
    customerNameRequired.classList.toggle("d-none", !isNewCustomer);
}
// Fill customer details when selected; keep the fields editable.
// Customer options may include data-email and data-phone.
function crmFillCustomerInfo(modalEl, optionEl) {
  if (!modalEl || !optionEl) return;
  const isNewCustomer = optionEl.getAttribute("data-value") === "new";
  if (modalEl.id === "addDealModal") {
    crmSetDealCustomerMode(modalEl, isNewCustomer);
  }
  const setField = (name, value) => {
    const f = modalEl.querySelector('[name="' + name + '"]');
    if (f && !isNewCustomer) f.value = value;
  };
  setField(
    "customer_name",
    optionEl.getAttribute("data-name") || optionEl.textContent.trim(),
  );
  setField("customer_email", optionEl.getAttribute("data-email") || "");
  setField(
    "customer_phone",
    crmFormatPhone(optionEl.getAttribute("data-phone") || ""),
  );
}

// Show service fields based on the selected arrangement.
// Match the option text so database IDs can remain in data-value.
function crmServiceKey(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("pickup") || t.includes("pick up") || t.includes("pick-up"))
    return "pickup";
  if (t.includes("delivery")) return "delivery";
  if (t.includes("catering") || t.includes("on-site") || t.includes("onsite"))
    return "onsite";
  return "";
}

// Show the service field group that matches the selected key.
// Disable and clear hidden fields so they are not required or submitted.
function crmShowServiceFields(modalEl, key) {
  if (!modalEl) return;
  modalEl.querySelectorAll(".service-fields").forEach((box) => {
    const on = box.dataset.service === key;
    box.classList.toggle("d-none", !on);
    box.querySelectorAll("input, textarea, select").forEach((el) => {
      el.disabled = !on;
      if (!on) {
        el.value = "";
        if (el.setCustomValidity) el.setCustomValidity("");
      }
    });
  });
}

// Require the end time to follow the start time for on-site catering.
if (!window.__crmServiceTimeBound) {
  window.__crmServiceTimeBound = true;
  document.addEventListener("input", function (e) {
    const el = e.target;
    if (!el || (el.name !== "event_start_time" && el.name !== "event_end_time"))
      return;
    const box = el.closest(".service-fields");
    if (!box) return;
    const start = box.querySelector('[name="event_start_time"]');
    const end = box.querySelector('[name="event_end_time"]');
    if (!start || !end) return;
    end.setCustomValidity(
      start.value && end.value && end.value <= start.value
        ? "Event end time must be after the start time."
        : "",
    );
  });
}

// Handle table row actions.
function crmSetText2(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function crmSetValue(modal, name, value) {
  const el = modal.querySelector('[name="' + name + '"]');
  if (el) el.value = value === null || value === undefined ? "" : value;
}

function crmFillContactModal(d) {
  const modal = document.getElementById("editCustomerModal");
  if (!modal) return;
  crmSetValue(modal, "id", d.id);
  crmSetValue(modal, "customer_name", d.name);
  crmSetValue(modal, "email", d.email);
  crmSetValue(modal, "phone", crmFormatPhone(d.phone));
  crmSelectDropdown(
    modal.querySelector('.dropdown[data-field="staff_id"]'),
    d.staff,
    d.staffId,
  );
}

function crmFillLeadDealModal(d) {
  const modal = document.getElementById("editLeadDealModal");
  if (!modal) return;
  const isDeal = String(d.type || "").toLowerCase() === "deal";
  const assignmentNeedsCorrection =
    Boolean(d.staffId) &&
    (d.staffStatus !== "Active" || d.staffRole !== "Sales Staff");
  const staffOptions = (window.crmLeadStaff || []).map((staff) => ({
    value: staff.user_id,
    text: staff.full_name || "",
  }));
  const title = document.getElementById("editLeadDealModalLabel");
  if (title) title.textContent = isDeal ? "Edit Deal" : "Edit Lead";
  const amountField = document.getElementById("editQuotationAmount");
  const amountBlock = amountField && amountField.closest(".mb-2");
  if (amountBlock) amountBlock.classList.toggle("d-none", !isDeal);
  const staffDropdown = modal.querySelector('.dropdown[data-field="staff_id"]');
  if (staffDropdown) {
    staffDropdown.dataset.required =
      isDeal || assignmentNeedsCorrection ? "true" : "false";
  }
  const assignmentWarning = document.getElementById(
    "editLeadDealAssignmentWarning",
  );
  if (assignmentWarning) {
    assignmentWarning.classList.toggle("d-none", !assignmentNeedsCorrection);
    assignmentWarning.textContent = assignmentNeedsCorrection
      ? `This record is assigned to ${d.staff || "an ineligible user"} (${d.staffRole || "unknown role"}${d.staffStatus ? `, ${d.staffStatus}` : ""}). Select an active Sales Staff user to correct the assignment before saving.`
      : "";
  }
  crmSetValue(modal, "id", d.id);
  crmSetValue(modal, "record_type", isDeal ? "deal" : "lead");
  crmSetValue(modal, "event_name", d.name);
  crmSetValue(modal, "customer_name", d.customer);
  crmSetValue(modal, "quotation_amount", d.amount);
  crmFillMenuIfEmpty(
    "editLeadDealStageDropdown",
    isDeal ? CRM_DEAL_STAGES : CRM_LEAD_STAGES,
  );
  window.populateDropdown(
    "editLeadDealStaffDropdown",
    isDeal
      ? staffOptions
      : [{ value: "", text: "Unassigned" }, ...staffOptions],
  );
  crmSelectDropdown(
    modal.querySelector('.dropdown[data-field="stage"]'),
    d.stage,
  );
  if (assignmentNeedsCorrection) {
    crmSelectDropdown(staffDropdown, "");
    const toggleLabel =
      staffDropdown &&
      staffDropdown.querySelector(".custom-dropdown-toggle span");
    if (toggleLabel) {
      toggleLabel.textContent = "Select eligible staff to correct assignment";
      toggleLabel.classList.add("text-muted");
    }
    crmSetHidden(staffDropdown, "");
  } else {
    crmSelectDropdown(staffDropdown, d.staff, d.staffId);
  }
}
// Read the selected record from its table row.
function crmGetRowItem(kind, row) {
  const t = (i) => (row.cells[i] ? row.cells[i].textContent.trim() : "");
  const d = row.dataset || {};
  if (kind === "contacts") {
    return {
      id: d.id || "",
      name: t(0),
      email: d.email || t(1),
      phone: d.phone || t(2),
      staff: t(3),
      staffId: d.staffId || "",
    };
  }
  const amountText = t(5);
  return {
    id: d.id || "",
    name: t(0),
    customer: t(1),
    type: d.recordType || t(2),
    stage: t(3),
    staff: d.staffName || t(4),
    staffId: d.staffId || "",
    staffRole: d.staffRole || "",
    staffStatus: d.staffStatus || "",
    assignmentNeedsCorrection: d.assignmentNeedsCorrection === "true",
    amount:
      amountText === "—" || amountText === ""
        ? null
        : amountText.replace(/[₱,\s]/g, ""),
  };
}

if (!window.__crmRowButtonsBound) {
  window.__crmRowButtonsBound = true;
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(
      ".action-btn-view, .action-btn-edit, .action-btn-delete",
    );
    if (!btn) return;
    const row = btn.closest("tr:not(.empty-data-row)");
    if (!row) return;
    const table = row.closest("table");
    if (!table) return;
    const kind =
      table.id === "contactsTable"
        ? "contacts"
        : table.id === "leadsDealsTable"
          ? "leads"
          : null;
    if (!kind) return;

    const item = crmGetRowItem(kind, row);
    window.crmSelected = { kind: kind, item: item };

    if (kind === "contacts") {
      if (btn.classList.contains("action-btn-delete")) {
        crmSetText2("#deleteContactModal strong", item.name || "");
        const idInput = document.querySelector(
          '#deleteContactModal input[name="id"]',
        );
        if (idInput) idInput.value = item.id;
      } else {
        crmFillContactModal(item);
        crmTakeSnapshot("editCustomerModal");
        crmSetText2(
          "#discardChangesModal strong.text-highlight",
          item.name || "",
        );
      }
      return;
    }

    const isDeal = String(item.type || "").toLowerCase() === "deal";
    if (btn.classList.contains("action-btn-view")) {
      const stageClass =
        CRM_STAGE_CLASS[String(item.stage || "").toLowerCase()] || "stage-new";
      const amountBlock = document
        .getElementById("viewQuotationAmount")
        ?.closest(".view-field-block");
      if (amountBlock) amountBlock.classList.toggle("d-none", !isDeal);
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set("viewEventName", item.name || "-");
      set("viewCustomerName", item.customer || "-");
      set("viewStaffName", item.staff || "-");
      set("viewQuotationAmount", crmFormatAmount(item.amount));
      const typeBox = document.getElementById("viewTypeBadge");
      if (typeBox)
        typeBox.innerHTML = `<span class="type-pill ${isDeal ? "type-deal" : "type-lead"}">${isDeal ? "Deal" : "Lead"}</span>`;
      const stageBox = document.getElementById("viewStageBadge");
      if (stageBox)
        stageBox.innerHTML = `<span class="stage-pill ${stageClass}">${crmEscape(item.stage)}</span>`;
      const title = document.getElementById("viewLeadDealModalLabel");
      if (title) title.textContent = isDeal ? "Deal Details" : "Lead Details";
    } else if (btn.classList.contains("action-btn-delete")) {
      crmSetText2("#deleteDealModal strong", item.name || "");
      crmSetText2(
        "#deleteDealModalLabel",
        isDeal ? "Delete Deal" : "Delete Lead",
      );
      const idInput = document.querySelector(
        '#deleteDealModal input[name="id"]',
      );
      if (idInput) idInput.value = item.id;
      const typeInput = document.querySelector(
        '#deleteDealModal input[name="record_type"]',
      );
      if (typeInput) typeInput.value = isDeal ? "deal" : "lead";
    } else {
      crmFillLeadDealModal(item);
      crmTakeSnapshot("editLeadDealModal");
    }
  });
}

// Search and filter page tables.
window.initTableSearchAndFilters = function () {
  // Search and filters apply to Contacts, Leads & Deals, Tickets, and Activities.
  const table =
    document.getElementById("leadsDealsTable") ||
    document.getElementById("contactsTable") ||
    document.getElementById("ticketsTable") ||
    document.getElementById("activitiesTable");
  if (!table) return;

  const searchInput =
    document.getElementById("leadsSearchInput") ||
    document.getElementById("contactsSearchInput") ||
    document.getElementById("ticketsSearchInput") ||
    document.getElementById("activitiesSearchInput");

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const isContactsPage = table.id === "contactsTable";
  const isTicketsPage = table.id === "ticketsTable";
  const isActivitiesPage = table.id === "activitiesTable";
  // Table column indexes are zero-based.
  const staffCol = isContactsPage
    ? 3
    : isTicketsPage
      ? 5
      : isActivitiesPage
        ? 6
        : 4; // Assigned staff column.
  const typeCol = isActivitiesPage ? 3 : 2; // Type column.
  const statusCol = isActivitiesPage ? 5 : 3; // Status column.
  const hasStatus = isTicketsPage || isActivitiesPage;

  window.activeTableFilters = {
    search: "",
    type: "all",
    stage: "all",
    staff: "all",
    status: "all",
    priority: "all",
  };

  function ensureNoResultsRow() {
    let noResultsRow = tbody.querySelector(".no-results-row");
    if (!noResultsRow) {
      const colCount = table.querySelectorAll("thead th").length || 6;
      noResultsRow = document.createElement("tr");
      noResultsRow.className = "no-results-row";
      noResultsRow.style.display = "none";
      noResultsRow.innerHTML = `
        <td colspan="${colCount}" class="text-center py-5 text-muted fw-medium fs-6">
          <div class="d-flex flex-column align-items-center justify-content-center gap-2">
            <i class="bi bi-search fs-3 opacity-50"></i>
            <span>No results found</span>
          </div>
        </td>
      `;
      tbody.appendChild(noResultsRow);
    }
    return noResultsRow;
  }

  function applyFilters() {
    const dataRows = tbody.querySelectorAll(
      "tr:not(.no-results-row):not(.empty-data-row)",
    );
    const noResultsRow = ensureNoResultsRow();
    const filters = window.activeTableFilters;
    let visibleCount = 0;

    dataRows.forEach((row) => {
      // Exclude the final action column from search.
      const searchText = Array.from(row.cells)
        .slice(0, -1)
        .map((c) => c.textContent)
        .join(" ")
        .toLowerCase();
      const typeText = row.cells[typeCol]
        ? row.cells[typeCol].textContent.trim().toLowerCase()
        : "";
      const stageText = row.cells[3]
        ? row.cells[3].textContent.trim().toLowerCase()
        : "";
      const staffText = row.cells[staffCol]
        ? row.cells[staffCol].textContent.trim().toLowerCase()
        : "";
      const statusText = row.cells[statusCol]
        ? row.cells[statusCol].textContent.trim().toLowerCase()
        : "";
      const priorityText = row.cells[4]
        ? row.cells[4].textContent.trim().toLowerCase()
        : "";
      const matchesSearch =
        filters.search === "" || searchText.includes(filters.search);
      const matchesType =
        isContactsPage || filters.type === "all" || typeText === filters.type;
      const matchesStage =
        isContactsPage ||
        isActivitiesPage ||
        filters.stage === "all" ||
        stageText === filters.stage;
      let matchesStaff = filters.staff === "all" || staffText === filters.staff;
      if (isContactsPage && filters.staff !== "all") {
        const assignedNames = JSON.parse(row.dataset.staffNames || "[]");
        matchesStaff = assignedNames.includes(filters.staff);
      }
      const matchesStatus =
        !hasStatus || filters.status === "all" || statusText === filters.status;
      const matchesPriority =
        !isTicketsPage ||
        filters.priority === "all" ||
        priorityText === filters.priority;
      if (
        matchesSearch &&
        matchesType &&
        matchesStage &&
        matchesStaff &&
        matchesStatus &&
        matchesPriority
      ) {
        row.style.display = "";
        visibleCount++;
      } else {
        row.style.display = "none";
      }
    });

    noResultsRow.style.display =
      dataRows.length > 0 && visibleCount === 0 ? "" : "none";
  }

  if (searchInput) {
    searchInput.oninput = function (e) {
      window.activeTableFilters.search = e.target.value.trim().toLowerCase();
      applyFilters();
    };
  }

  window.applyTableFilters = applyFilters;
  applyFilters();
};

// Handle dropdown selections, including dynamically added options.
// Custom options use this dropdown-item structure:
// Use data-value to submit an ID instead of the option text.
// Use populateDropdown() to create options programmatically.
if (!window.__crmFilterDropdownBound) {
  window.__crmFilterDropdownBound = true;
  document.addEventListener("click", function (e) {
    const item = e.target.closest(
      ".custom-dropdown-menu .custom-dropdown-item",
    );
    if (!item) return;
    e.preventDefault();
    if (item.dataset.dropdownState === "true") return;

    const menu = item.closest(".custom-dropdown-menu");
    const dropdown = item.closest(".dropdown");
    if (!menu || !dropdown) return;

    const labelSpan = dropdown.querySelector(".custom-dropdown-toggle span");
    const selectedText = item.textContent.trim();
    const selectedLower = selectedText.toLowerCase();
    const isAll = /^all (types|stages|staff|status|priority)$/i.test(
      selectedText,
    );

    // Save the initial label so it can be restored.
    if (labelSpan && !labelSpan.dataset.defaultLabel) {
      labelSpan.dataset.defaultLabel = labelSpan.textContent.trim();
    }

    // Modal dropdowns update the label and hidden input.
    if (item.closest(".modal")) {
      if (labelSpan) {
        labelSpan.textContent = selectedText;
        labelSpan.classList.remove("text-muted");
      }
      const v = item.getAttribute("data-value");
      const value = v !== null ? v : selectedText;
      const field = dropdown.getAttribute("data-field");
      if (field) crmSetHidden(dropdown, value);
      const toggle = dropdown.querySelector(".custom-dropdown-toggle");
      if (toggle) toggle.classList.remove("dd-invalid");
      if (field === "staff_id" && item.closest("#editLeadDealModal")) {
        const warning = document.getElementById(
          "editLeadDealAssignmentWarning",
        );
        if (warning && value) warning.classList.add("d-none");
      }
      if (
        field === "staff_id" &&
        item.closest("#addActivityModal, #editActivityModal")
      ) {
        crmActivityUpdateStaffOptions(item.closest("form"), value, "");
      }
      if (
        item.closest("#addActivityModal, #editActivityModal") &&
        ["customer_id", "lead_deal_id", "ticket_id"].includes(field)
      ) {
        crmActivityHandleRelatedSelection(item.closest("form"), field, value);
      }

      // Show the matching service fields when the arrangement changes.
      if (field === "service_arrangement")
        crmShowServiceFields(
          item.closest(".modal"),
          crmServiceKey(selectedText),
        );

      // Fill the customer details when a customer is selected.
      if (field === "customer_id") {
        const addModal = item.closest("#addDealModal, #addLeadModal");
        if (addModal) crmFillCustomerInfo(addModal, item);
      }
      if (field === "customer_id" && item.closest("#addDealModal")) {
        crmFilterRelatedLeads(value);
      }
      return;
    }

    // Restore the default label when clearing a filter.
    if (labelSpan) {
      labelSpan.textContent = isAll
        ? labelSpan.dataset.defaultLabel || selectedText
        : selectedText;
      labelSpan.classList.remove("text-muted");
    }

    if (
      !window.activeTableFilters ||
      typeof window.applyTableFilters !== "function"
    )
      return;

    let key;
    if (menu.id === "typesFilterDropdown") key = "type";
    else if (menu.id === "statusFilterDropdown") key = "status";
    else if (menu.id === "priorityFilterDropdown") key = "priority";
    else if (menu.id === "stagesFilterDropdown") key = "stage";
    else if (
      menu.id === "staffFilterDropdownList" ||
      dropdown.classList.contains("staff-filter-dropdown")
    )
      key = "staff";
    else
      key =
        selectedLower === "lead" || selectedLower === "deal" ? "type" : "stage";
    // Clear search before applying the new filter.
    const activeSearchInput =
      document.getElementById("leadsSearchInput") ||
      document.getElementById("contactsSearchInput") ||
      document.getElementById("ticketsSearchInput") ||
      document.getElementById("activitiesSearchInput");
    if (activeSearchInput) activeSearchInput.value = "";
    window.activeTableFilters.search = "";
    // Rebuild the stage options when the type changes.
    if (key === "type") crmUpdateStageFilter(isAll ? "all" : selectedLower);
    window.activeTableFilters[key] = isAll ? "all" : selectedLower;
    window.applyTableFilters();
  });
}

function getStatusBadgeHTML(statusText) {
  if (!statusText) return "";
  const normalized = String(statusText).trim().toLowerCase();
  let statusClass = "";

  switch (normalized) {
    case "upcoming":
    case "new inquiry":
    case "pending":
      statusClass = "status-upcoming";
      break;
    case "in progress":
    case "in discussion":
    case "quotation sent":
    case "negotiation":
      statusClass = "status-in-progress";
      break;
    case "cancelled":
    case "declined":
    case "closed":
      statusClass = "status-cancelled";
      break;
    case "completed":
    case "confirmed":
    case "resolved":
      statusClass = "status-completed";
      break;
    default:
      statusClass = "status-upcoming";
  }

  return `<span class="status-badge ${statusClass}">${crmEscape(String(statusText).trim())}</span>`;
}

function renderStaticStatusBadges() {
  // Convert API-provided status spans to styled badges.
  document.querySelectorAll("[data-status], .tablebadge").forEach((el) => {
    if (el.classList.contains("status-badge")) return; // Skip existing badges.
    if (el.tagName === "TR" || el.tagName === "TABLE") return;
    const raw = el.getAttribute("data-status") || el.textContent;
    const html = getStatusBadgeHTML(raw);
    if (!html) return;
    if (el.tagName === "TD")
      el.innerHTML = html; // Preserve the table cell.
    else el.outerHTML = html;
  });

  // Also render plain-text statuses in the Activities table.
  document
    .querySelectorAll(
      "#activitiesTable tbody tr:not(.empty-data-row):not(.no-results-row)",
    )
    .forEach((row) => {
      const cell = row.cells[5];
      if (!cell || cell.querySelector(".status-badge")) return;
      const text = cell.textContent.trim();
      if (text) cell.innerHTML = getStatusBadgeHTML(text);
    });
}
window.renderStaticStatusBadges = renderStaticStatusBadges; // Expose this helper to the page loader.

// Reset forms and validate required dropdowns.
// Reset Add forms, including their dropdown selections.
function crmResetModal(m) {
  m.querySelectorAll("form").forEach((f) => f.reset());

  crmShowServiceFields(m, "");
  if (m.id === "addDealModal") {
    ["customer_name", "customer_email", "customer_phone"].forEach((name) => {
      const field = m.querySelector(`[name="${name}"]`);
      if (!field) return;
      field.readOnly = true;
      field.required = false;
    });
    const relatedDropdown = m.querySelector(
      '.dropdown[data-field="related_lead_id"]',
    );
    if (relatedDropdown) relatedDropdown.dataset.required = "true";
    const relatedHelp = m.querySelector("#addDealRelatedLeadHelp");
    if (relatedHelp)
      relatedHelp.textContent =
        "Choose a Lead belonging to the selected customer.";
    const relatedRequired = m.querySelector("#addDealLeadRequired");
    if (relatedRequired) relatedRequired.classList.remove("d-none");
    const customerNameRequired = m.querySelector(
      "#addDealCustomerNameRequired",
    );
    if (customerNameRequired) customerNameRequired.classList.add("d-none");
  }

  // Remove only hidden inputs created by the dropdown helper.
  m.querySelectorAll('.dropdown[data-field] input[type="hidden"]').forEach(
    (h) => h.remove(),
  );

  m.querySelectorAll(".custom-dropdown-toggle").forEach((t) => {
    t.classList.remove("dd-invalid");
    const s = t.querySelector("span");
    if (!s || s.dataset.defaultLabel === undefined) return;
    s.textContent = s.dataset.defaultLabel;
    s.classList.toggle("text-muted", s.dataset.wasMuted === "1");
  });

  const rel = m.querySelector(
    '.dropdown[data-field="related_lead_id"] .custom-dropdown-toggle',
  );
  if (rel) rel.disabled = true;
  m.querySelectorAll(".custom-dropdown-menu li").forEach((li) => {
    li.style.display = "";
  });

  delete m.dataset.snapshot;
  m.dataset.keepState = "0";

  m.querySelectorAll("textarea[maxlength]").forEach(crmUpdateCharCount);
}

if (!window.__crmModalResetBound) {
  window.__crmModalResetBound = true;

  // Reset Add forms when they close.
  document.addEventListener("hidden.bs.modal", function (e) {
    const m = e.target;
    if (!m.id || m.id.indexOf("add") !== 0) return;
    // Keep the form values while the discard prompt is open.
    if (m.dataset.keepState === "1") {
      m.dataset.keepState = "0";
      return;
    }
    crmResetModal(m);
  });

  document.addEventListener("shown.bs.modal", function (e) {
    const m = e.target;
    m.dataset.pendingDiscard = "0";
    if (m.id && m.id.indexOf("add") === 0 && !m.dataset.snapshot)
      crmTakeSnapshot(m.id);
  });

  // Require a selection for dropdowns marked data-required="true".
  document.addEventListener(
    "submit",
    function (e) {
      const form = e.target;
      if (!form || !form.closest || !form.closest(".modal")) return;
      let ok = true;
      form.querySelectorAll('.dropdown[data-required="true"]').forEach((dd) => {
        const h = dd.querySelector('input[type="hidden"]');
        const toggle = dd.querySelector(".custom-dropdown-toggle");
        const empty = !h || h.value === "";
        if (toggle) toggle.classList.toggle("dd-invalid", empty);
        if (empty) ok = false;
      });
      if (!ok) e.preventDefault();
    },
    true,
  );
}
// Confirm before closing forms with unsaved changes.
// Ask before closing Add or Edit forms with unsaved changes.
// Find the prompt from data-discard-modal on the Cancel button,
// or use a modal whose ID contains "discard".
function crmFormState(modal) {
  const fields = Array.from(modal.querySelectorAll("input, textarea, select"))
    .filter((el) => el.type !== "button" && el.type !== "submit")
    .map((el) => [
      el.name || el.id || "",
      el.type === "checkbox" || el.type === "radio" ? el.checked : el.value,
    ]);
  const labels = Array.from(
    modal.querySelectorAll(".custom-dropdown-toggle span"),
  ).map((s) => s.textContent.trim());
  return JSON.stringify([fields, labels]);
}

function crmTakeSnapshot(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.dataset.snapshot = crmFormState(modal);
}

// Run the callback after this modal closes.
function crmAfterHidden(el, fn) {
  const h = function (ev) {
    if (ev.target !== el) return;
    el.removeEventListener("hidden.bs.modal", h);
    fn();
  };
  el.addEventListener("hidden.bs.modal", h);
}

function crmFindDiscardModal(btn, modalEl) {
  const id =
    (btn && btn.dataset && btn.dataset.discardModal) ||
    modalEl.dataset.discardModal;
  if (id && document.getElementById(id)) return document.getElementById(id);
  return document.querySelector('.modal[id*="iscard"]');
}

function crmCancelModal(modalEl, btn) {
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const changed =
    modalEl.dataset.snapshot !== undefined &&
    crmFormState(modalEl) !== modalEl.dataset.snapshot;

  if (!changed) {
    modal.hide();
    return;
  } // Close immediately when nothing changed.

  const discardEl = crmFindDiscardModal(btn, modalEl);

  // Use a browser confirmation if no discard modal exists.
  if (!discardEl) {
    if (
      window.confirm(
        "You have unsaved information in this form. Are you sure you want to discard it?",
      )
    ) {
      modal.hide(); // The Add form resets when hidden.
    }
    return;
  }

  // Return to the source modal when the user chooses Keep Edit.
  const keepBtn = discardEl.querySelector('[data-bs-toggle="modal"]');
  if (keepBtn) keepBtn.setAttribute("data-bs-target", "#" + modalEl.id);

  if (/^add/i.test(modalEl.id)) {
    const strong = discardEl.querySelector("strong.text-highlight");
    if (strong) {
      const nameInput = modalEl.querySelector(
        'input[type="text"]:not([readonly])',
      );
      strong.textContent = (nameInput && nameInput.value.trim()) || "this form";
    }
    modalEl.dataset.keepState = "1"; // Keep the Add form while the prompt is open.
    modalEl.dataset.pendingDiscard = "1"; // Reset it if the user discards changes.
  }

  // Close the form before showing the discard prompt.
  crmAfterHidden(modalEl, function () {
    bootstrap.Modal.getOrCreateInstance(discardEl).show();
  });
  modal.hide();
}

if (!window.__crmEditCancelBound) {
  window.__crmEditCancelBound = true;

  // Capture the cancel click before Bootstrap dismisses the modal.
  document.addEventListener(
    "click",
    function (e) {
      let modalEl = null,
        btn = null;
      const jsBtn = e.target.closest(".js-edit-cancel"); // Handle Edit cancel buttons.
      if (jsBtn) {
        btn = jsBtn;
        modalEl = document.getElementById(jsBtn.dataset.editModal);
      } else {
        const dismiss = e.target.closest('[data-bs-dismiss="modal"]');
        const host = dismiss ? dismiss.closest(".modal") : null;
        // The close button bypasses the discard prompt.
        const isX = dismiss && dismiss.classList.contains("btn-close");
        if (
          host &&
          !isX &&
          /^add/i.test(host.id) &&
          dismiss.type !== "submit"
        ) {
          btn = dismiss;
          modalEl = host;
        }
      }
      if (!modalEl) return;

      e.preventDefault();
      e.stopPropagation();
      crmCancelModal(modalEl, btn);
    },
    true,
  );

  // Handle the discard prompt buttons.
  document.addEventListener("click", function (e) {
    const b = e.target.closest('.modal[id*="iscard"] button');
    if (!b) return;
    const isKeep = b.hasAttribute("data-bs-toggle"); // Keep Edit reopens the form.
    document
      .querySelectorAll('.modal[data-pending-discard="1"]')
      .forEach((m) => {
        m.dataset.pendingDiscard = "0";
        if (!isKeep) crmResetModal(m); // Discard resets the Add form.
      });
  });

  // Treat Escape or an outside click as discard.
  document.addEventListener("hidden.bs.modal", function (e) {
    if (!/iscard/.test(e.target.id)) return;
    document
      .querySelectorAll('.modal[data-pending-discard="1"]')
      .forEach((m) => {
        m.dataset.pendingDiscard = "0";
        crmResetModal(m);
      });
  });
}

// Initialize direct page loads; the shell initializes injected pages.
document.addEventListener("DOMContentLoaded", () => {
  window.loadCrmPageData();
});

// Format phone number inputs.
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("input", function (e) {
    if (e.target && e.target.classList.contains("phone-input-field")) {
      e.target.value = crmFormatPhone(e.target.value);
    }
  });

  // Prevent Backspace from removing the +63 prefix.
  document.addEventListener("keydown", function (e) {
    if (
      e.target &&
      e.target.classList.contains("phone-input-field") &&
      e.key === "Backspace"
    ) {
      const el = e.target;
      if (el.selectionStart === el.selectionEnd && el.selectionStart <= 4)
        e.preventDefault();
    }
  });
});

// Restrict numeric input to digits and an optional decimal point.
function crmCleanNumber(value, integerOnly) {
  let v = String(value).replace(integerOnly ? /[^\d]/g : /[^\d.]/g, "");
  if (!integerOnly) {
    const i = v.indexOf(".");
    if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ""); // Keep only the first decimal point.
  }
  return v;
}

if (!window.__crmNumberInputBound) {
  window.__crmNumberInputBound = true;

  // Block invalid numeric keys.
  document.addEventListener("keydown", function (e) {
    const el = e.target;
    if (!el || el.type !== "number") return;
    const integerOnly = el.dataset.integer === "true";
    const blocked = ["e", "E", "+", "-"];
    if (integerOnly) blocked.push(".", ",");
    if (blocked.includes(e.key)) e.preventDefault();
  });

  // Remove invalid characters from pasted values.
  document.addEventListener("paste", function (e) {
    const el = e.target;
    if (!el || el.type !== "number") return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text");
    const cleaned = crmCleanNumber(text, el.dataset.integer === "true");
    if (cleaned) {
      el.value = cleaned;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // Prevent the mouse wheel from changing numeric values.
  document.addEventListener(
    "wheel",
    function (e) {
      if (
        e.target &&
        e.target.type === "number" &&
        document.activeElement === e.target
      )
        e.target.blur();
    },
    { passive: true },
  );
}

// Ticket page handlers.
function crmTicketBadgeHTML(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return `<span class="ticket-badge ticket-${crmEscape(value.toLowerCase())}">${crmEscape(value)}</span>`;
}

function crmRenderTicketBadges() {
  document
    .querySelectorAll("[data-ticket-status], [data-ticket-priority]")
    .forEach((el) => {
      const text =
        el.getAttribute("data-ticket-status") ||
        el.getAttribute("data-ticket-priority");
      el.innerHTML = crmTicketBadgeHTML(text);
    });
}

// Update the character count when a form opens.
function crmUpdateCharCount(textarea) {
  const counter = textarea.parentElement.querySelector(".char-count");
  if (counter)
    counter.textContent =
      textarea.value.length +
      "/" +
      (textarea.maxLength > 0 ? textarea.maxLength : 150) +
      " characters";
}
function crmShowTicketNotice(message, type) {
  const table = document.getElementById("ticketsTable");
  const main = table && table.closest("main");
  if (!main) return;
  let notice = main.querySelector(".tickets-api-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "tickets-api-notice alert d-none";
    notice.setAttribute("role", "alert");
    const card = table.closest(".card");
    if (card) main.insertBefore(notice, card);
  }
  notice.className = `tickets-api-notice alert alert-${type}`;
  notice.textContent = message;
}
function crmShowTicketFormMessage(form, message, type) {
  let notice = form.parentElement.querySelector(".ticket-api-form-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "ticket-api-form-notice alert mb-3";
    notice.setAttribute("role", "alert");
    form.parentElement.insertBefore(notice, form);
  }
  notice.className = `ticket-api-form-notice alert alert-${type} mb-3`;
  notice.textContent = message;
}
async function crmGetTicketCsrfToken(table) {
  const response = await fetch("tickets-api.php?action=list", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json();
  if (
    !response.ok ||
    !data.success ||
    typeof data.csrf_token !== "string" ||
    !data.csrf_token
  ) {
    throw new Error(
      data.message || "Unable to verify the Tickets security token.",
    );
  }
  table.dataset.csrfToken = data.csrf_token;
  return data.csrf_token;
}
async function crmSendTicketAction(action, formData, table) {
  const csrfToken = await crmGetTicketCsrfToken(table);
  formData.set("csrf_token", csrfToken);
  const response = await fetch(
    `tickets-api.php?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: formData,
    },
  );
  const data = await response.json();
  return { response, data };
}
async function crmDeleteTicket(ticketId, ticketName, button) {
  const table = document.getElementById("ticketsTable");
  if (!table || !ticketId) {
    crmShowTicketNotice(
      "The selected ticket could not be identified.",
      "danger",
    );
    return;
  }
  if (
    !window.confirm(
      `Delete ticket "${ticketName}"? This action cannot be undone.`,
    )
  )
    return;
  const previousDisabled = button.disabled;
  button.disabled = true;
  try {
    const formData = new FormData();
    formData.set("id", ticketId);
    const { response, data } = await crmSendTicketAction(
      "delete",
      formData,
      table,
    );
    if (!response.ok || !data.success) {
      throw new Error(data.message || "Unable to delete this ticket.");
    }
    crmShowTicketNotice(
      data.message || "Ticket deleted successfully.",
      "success",
    );
    await crmLoadTickets(table);
  } catch (error) {
    console.error("Ticket deletion failed:", error);
    crmShowTicketNotice(
      error.message || "Unable to delete this ticket. Please try again.",
      "danger",
    );
  } finally {
    button.disabled = previousDisabled;
  }
}
if (!window.__crmTicketFormsBound) {
  window.__crmTicketFormsBound = true;
  document.addEventListener("shown.bs.modal", (event) => {
    if (!["addTicketModal", "editTicketModal"].includes(event.target.id))
      return;
    event.target
      .querySelectorAll(".ticket-api-form-notice")
      .forEach((notice) => notice.remove());
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    const formId = form && form.getAttribute && form.getAttribute("id");
    if (!["addTicketForm", "editTicketForm"].includes(formId)) return;
    event.preventDefault();
    if (form.dataset.submitting === "true") return;
    const table = document.getElementById("ticketsTable");
    if (!table) {
      crmShowTicketFormMessage(
        form,
        "The Tickets page is no longer available. Reopen it and try again.",
        "danger",
      );
      return;
    }
    const missingDropdown = Array.from(
      form.querySelectorAll('.dropdown[data-required="true"]'),
    ).find((dropdown) => {
      const input = dropdown.querySelector('input[type="hidden"]');
      const toggle = dropdown.querySelector(".custom-dropdown-toggle");
      const missing = !input || !input.value;
      if (toggle) toggle.classList.toggle("dd-invalid", missing);
      return missing;
    });
    if (!form.checkValidity() || missingDropdown) {
      form.reportValidity();
      crmShowTicketFormMessage(
        form,
        missingDropdown &&
          missingDropdown.dataset.field === "staff_id" &&
          (!Array.isArray(window.crmTicketStaff) ||
            window.crmTicketStaff.length === 0)
          ? "No active Customer Service Staff users are available. Add or activate one in Settings > Users before saving a ticket."
          : missingDropdown
            ? "Select a customer, status, priority, and assigned staff member."
            : "Complete the required ticket fields before saving.",
        "warning",
      );
      return;
    }
    form.dataset.submitting = "true";
    const submitButton = document.querySelector(
      `[form="${formId}"][type="submit"]`,
    );
    if (submitButton) submitButton.disabled = true;
    const priorNotice = form.parentElement.querySelector(
      ".ticket-api-form-notice",
    );
    if (priorNotice) priorNotice.remove();
    try {
      const action = formId === "addTicketForm" ? "create" : "update";
      const { response, data } = await crmSendTicketAction(
        action,
        new FormData(form),
        table,
      );
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to save this ticket.");
      }
      if (document.getElementById("ticketsTable") !== table) return;
      const modal = form.closest(".modal");
      if (modal) {
        crmResetModal(modal);
        if (window.bootstrap && window.bootstrap.Modal) {
          window.bootstrap.Modal.getOrCreateInstance(modal).hide();
        }
      }
      crmShowTicketNotice(
        data.message || "Ticket saved successfully.",
        "success",
      );
      await crmLoadTickets(table);
    } catch (error) {
      console.error("Ticket save failed:", error);
      crmShowTicketFormMessage(
        form,
        error.message || "Unable to save this ticket. Please try again.",
        "danger",
      );
    } finally {
      delete form.dataset.submitting;
      if (submitButton) submitButton.disabled = false;
    }
  });
}

if (!window.__crmCharCountBound) {
  window.__crmCharCountBound = true;
  document.addEventListener("input", (e) => {
    if (e.target.matches("textarea[maxlength]")) crmUpdateCharCount(e.target);
  });
  document.addEventListener("shown.bs.modal", (e) =>
    e.target
      .querySelectorAll("textarea[maxlength]")
      .forEach(crmUpdateCharCount),
  );
}

// Ticket row actions use the row data below.
// Ticket rows include record, customer, staff, and description attributes.
if (!window.__crmTicketButtonsBound) {
  window.__crmTicketButtonsBound = true;
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(
      "#ticketsTable .action-btn-view, #ticketsTable .action-btn-edit, #ticketsTable .action-btn-delete",
    );
    if (!btn) return;
    const row = btn.closest("tr");
    if (!row) return;

    const t = (i) => (row.cells[i] ? row.cells[i].textContent.trim() : "");
    const d = row.dataset;
    const item = {
      id: d.id || "",
      no: t(0),
      name: t(1),
      customer: t(2),
      status: t(3),
      priority: t(4),
      staff: t(5),
      desc: d.desc || "",
      customerId: d.customerId,
      staffId: d.staffId,
    };
    if (btn.classList.contains("action-btn-delete")) {
      crmDeleteTicket(item.id, item.name, btn);
      return;
    }
    if (btn.classList.contains("action-btn-view")) {
      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value || "-";
      };
      set("viewTicketNo", item.no);
      set("viewTicketName", item.name);
      set("viewTicketDesc", item.desc);
      set("viewTicketCustomer", item.customer);
      set("viewTicketStaff", item.staff);
      [
        ["viewTicketStatus", item.status],
        ["viewTicketPriority", item.priority],
      ].forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const badge = document.createElement("span");
        badge.className = `ticket-badge ticket-${String(value || "").toLowerCase()}`;
        badge.textContent = value || "-";
        el.replaceChildren(badge);
      });
    } else {
      const modal = document.getElementById("editTicketModal");
      if (!modal) return;
      crmSetValue(modal, "id", item.id);
      crmSetValue(modal, "ticket_name", item.name);
      crmSetValue(modal, "description", item.desc);
      crmSetText2("#editTicketNo", item.no);
      const customerDisplay = modal.querySelector("#editTicketCustomerName");
      if (customerDisplay) customerDisplay.value = item.customer;
      crmSelectDropdown(
        modal.querySelector('.dropdown[data-field="status"]'),
        item.status,
      );
      crmSelectDropdown(
        modal.querySelector('.dropdown[data-field="priority"]'),
        item.priority,
      );
      crmSelectDropdown(
        modal.querySelector('.dropdown[data-field="staff_id"]'),
        item.staff,
        item.staffId,
      );
      const descriptionField = modal.querySelector('[name="description"]');
      if (descriptionField) crmUpdateCharCount(descriptionField);
      crmTakeSnapshot("editTicketModal");
      crmSetText2(
        "#discardTicketChangesModal strong.text-highlight",
        item.name || "",
      );
    }
  });
}
function crmShowActivityNotice(message, type) {
  const table = document.getElementById("activitiesTable");
  const main = table && table.closest("main");
  if (!main) return;
  let notice = main.querySelector(".activities-api-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "activities-api-notice alert";
    notice.setAttribute("role", "alert");
    const card = table.closest(".card");
    if (card) main.insertBefore(notice, card);
  }
  notice.className = `activities-api-notice alert alert-${type}`;
  notice.textContent = message;
}
function crmShowActivityFormMessage(form, message, type) {
  let notice = form.parentElement.querySelector(".activity-api-form-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "activity-api-form-notice alert mb-3";
    notice.setAttribute("role", "alert");
    form.parentElement.insertBefore(notice, form);
  }
  notice.className = `activity-api-form-notice alert alert-${type} mb-3`;
  notice.textContent = message;
}
function crmActivityDropdown(form, field) {
  return form && form.querySelector(`.dropdown[data-field="${field}"]`);
}
function crmActivityValue(form, field) {
  const dropdown = crmActivityDropdown(form, field);
  const input = dropdown && dropdown.querySelector('input[type="hidden"]');
  return input ? input.value : "";
}
function crmActivityClearDropdown(dropdown, label) {
  if (!dropdown) return;
  crmSelectDropdown(dropdown, label, "");
  crmSetHidden(dropdown, "");
}
function crmActivityAssignmentDepartment(form) {
  const related = crmActivityValue(form, "lead_deal_id");
  const ticket = crmActivityValue(form, "ticket_id");
  if (related && ticket) return "";
  if (/^(lead|deal):[1-9][0-9]*$/.test(related)) return "Sales Staff";
  if (!related && /^[1-9][0-9]*$/.test(ticket)) return "Customer Service Staff";
  return "";
}
function crmActivityUpdateStaffOptions(form, selectedStaffId, warningText) {
  const staffDropdown = crmActivityDropdown(form, "staff_id");
  if (!staffDropdown) return;
  const department = crmActivityAssignmentDepartment(form);
  const currentRole = window.crmActivityRole || "";
  const currentUserId = String(window.crmActivityUserId || "");
  const choices = (window.crmActivityStaff || [])
    .filter(
      (staff) => staff.status === "Active" && staff.role_name === department,
    )
    .filter((staff) => {
      if (
        currentRole === "Sales Staff" ||
        currentRole === "Customer Service Staff"
      ) {
        return String(staff.user_id) === currentUserId;
      }
      return true;
    })
    .map((staff) => ({ value: staff.user_id, text: staff.full_name || "" }));
  const menu = staffDropdown.querySelector(".dropdown-menu");
  const toggle = staffDropdown.querySelector(".custom-dropdown-toggle");
  if (!menu || !toggle) return;
  window.populateDropdown(menu.id, choices);
  if (choices.length === 0) {
    const emptyState = document.createElement("li");
    const message = document.createElement("span");
    message.className = "dropdown-item text-muted";
    message.textContent = department
      ? `No active ${department} are available.`
      : "Select a related Lead, Deal, or Ticket first.";
    emptyState.append(message);
    menu.append(emptyState);
  }
  toggle.disabled = choices.length === 0;
  const selected = choices.find(
    (staff) => String(staff.value) === String(selectedStaffId || ""),
  );
  if (selected) {
    crmSelectDropdown(staffDropdown, selected.text, selected.value);
  } else {
    crmActivityClearDropdown(staffDropdown, "Select staff");
  }
  const warning = form.querySelector(".activity-assignment-warning");
  if (warning) {
    const message =
      warningText ||
      (department
        ? choices.length === 0
          ? `No active ${department} are available for this activity.`
          : `Assign this activity to an active ${department} user.`
        : "Choose a related Lead or Deal, or a Ticket, to determine the correct staff department.");
    warning.textContent = message;
    warning.classList.toggle(
      "d-none",
      Boolean(selected) || (!warningText && choices.length > 0),
    );
  }
}
function crmActivityFilterRelatedOptions(form) {
  const contactId = crmActivityValue(form, "customer_id");
  ["lead_deal_id", "ticket_id"].forEach((field) => {
    const dropdown = crmActivityDropdown(form, field);
    if (!dropdown) return;
    dropdown.querySelectorAll(".custom-dropdown-item").forEach((item) => {
      const itemContactId = item.getAttribute("data-customer-id") || "";
      const isUnlinked = item.getAttribute("data-value") === "";
      item.classList.toggle(
        "d-none",
        !isUnlinked && (!contactId || itemContactId !== contactId),
      );
    });
    const currentValue = crmActivityValue(form, field);
    if (currentValue) {
      const selected = Array.from(
        dropdown.querySelectorAll(".custom-dropdown-item"),
      ).find((item) => item.getAttribute("data-value") === currentValue);
      if (!selected || selected.classList.contains("d-none")) {
        crmSelectDropdown(dropdown, "Not linked", "");
      }
    }
  });
}

function crmActivityHandleRelatedSelection(form, field, value) {
  if (!form) return;
  if (field === "lead_deal_id" && value) {
    crmActivityClearDropdown(
      crmActivityDropdown(form, "ticket_id"),
      "Not linked",
    );
  } else if (field === "ticket_id" && value) {
    crmActivityClearDropdown(
      crmActivityDropdown(form, "lead_deal_id"),
      "Not linked",
    );
  }
  if (field === "customer_id") crmActivityFilterRelatedOptions(form);
  crmActivityUpdateStaffOptions(form, "", "");
}
function crmPopulateActivityFormOptions(data) {
  window.crmActivityData = data;
  window.crmActivityStaff = data.staff;
  window.crmActivityRole = data.role;
  window.crmActivityUserId = data.user_id;
  const contactOptions = data.contacts.map((contact) => ({
    value: contact.contact_id,
    text: contact.customer_name || "",
  }));
  const relatedOptions = [
    { value: "", text: "Not linked" },
    ...data.leads.map((lead) => ({
      value: `lead:${lead.lead_id}`,
      text: `Lead: ${lead.inquiry_event_name}`,
      customerId: lead.contact_id,
    })),
    ...data.deals.map((deal) => ({
      value: `deal:${deal.deal_id}`,
      text: `Deal: ${deal.inquiry_event_name}`,
      customerId: deal.contact_id,
    })),
  ];
  const ticketOptions = [
    { value: "", text: "Not linked" },
    ...data.tickets.map((ticket) => ({
      value: ticket.ticket_id,
      text: `Ticket: ${ticket.ticket_name}`,
      customerId: ticket.contact_id,
    })),
  ];
  ["addActivityForm", "editActivityForm"].forEach((formId) => {
    const form = document.getElementById(formId);
    if (!form) return;
    window.populateDropdown(
      form.querySelector('[data-field="customer_id"] .dropdown-menu').id,
      contactOptions,
    );
    window.populateDropdown(
      form.querySelector('[data-field="lead_deal_id"] .dropdown-menu').id,
      relatedOptions,
    );
    window.populateDropdown(
      form.querySelector('[data-field="ticket_id"] .dropdown-menu').id,
      ticketOptions,
    );
    crmActivityFilterRelatedOptions(form);
    crmActivityUpdateStaffOptions(form, "", "");
  });
}
function crmActivityStateRow(tbody, message, className) {
  const row = document.createElement("tr");
  row.className = "empty-data-row";
  const cell = document.createElement("td");
  cell.colSpan = 8;
  cell.className = `text-center py-5 fw-medium fs-6 ${className || ""}`;
  cell.textContent = message;
  row.appendChild(cell);
  tbody.replaceChildren(row);
}
function crmIsActivityOverdue(dueDate, status) {
  if (!dueDate || ["Completed", "Cancelled"].includes(status)) return false;
  const today = new Date();
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return dueDate < todayString;
}
function crmActivityRecordLabel(type, name, id) {
  const recordName = String(name || "").trim();
  if (recordName) return `${type}: ${recordName}`;
  return id ? `${type} #${id}` : type;
}
async function crmLoadActivities(table) {
  const tbody = table.querySelector("tbody");
  if (!tbody || table.dataset.activitiesLoading === "true") return;
  table.dataset.activitiesLoading = "true";
  crmActivityStateRow(tbody, "Loading activities...", "text-muted");
  try {
    const response = await fetch("activities-api.php?action=list", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json();
    if (
      !response.ok ||
      !data.success ||
      !Array.isArray(data.activities) ||
      !Array.isArray(data.contacts) ||
      !Array.isArray(data.leads) ||
      !Array.isArray(data.deals) ||
      !Array.isArray(data.tickets) ||
      !Array.isArray(data.staff) ||
      typeof data.csrf_token !== "string" ||
      !data.csrf_token
    ) {
      throw new Error(data.message || "Unable to load activities.");
    }
    if (document.getElementById("activitiesTable") !== table) return;
    table.dataset.csrfToken = data.csrf_token;
    table.dataset.currentRole = data.role || "";
    crmPopulateActivityFormOptions(data);
    tbody.replaceChildren();
    if (data.activities.length === 0) {
      crmActivityStateRow(tbody, "No activities yet.", "text-muted");
    } else {
      data.activities.forEach((activity) => {
        const row = document.createElement("tr");
        row.dataset.id = String(activity.activity_id);
        row.dataset.customerId = String(activity.contact_id);
        row.dataset.leadId =
          activity.lead_id === null ? "" : String(activity.lead_id);
        row.dataset.dealId =
          activity.deal_id === null ? "" : String(activity.deal_id);
        row.dataset.ticketId =
          activity.ticket_id === null ? "" : String(activity.ticket_id);
        row.dataset.ticket = activity.ticket_name || "";
        row.dataset.relatedValue =
          activity.lead_id !== null
            ? `lead:${activity.lead_id}`
            : activity.deal_id !== null
              ? `deal:${activity.deal_id}`
              : activity.ticket_id !== null
                ? String(activity.ticket_id)
                : "";
        row.dataset.relatedType =
          activity.lead_id !== null
            ? "Lead"
            : activity.deal_id !== null
              ? "Deal"
              : activity.ticket_id !== null
                ? "Ticket"
                : "";
        row.dataset.staffId = String(activity.assigned_user_id);
        row.dataset.staffRole = activity.assigned_staff_role || "";
        row.dataset.staffStatus = activity.assigned_staff_status || "";
        row.dataset.date = activity.due_date || "";
        row.dataset.notes = activity.notes || "";
        row.dataset.activityName = activity.activity_name || "";
        const isOverdue = crmIsActivityOverdue(
          activity.due_date,
          activity.status,
        );
        row.dataset.isOverdue = String(isOverdue);
        const hasMultipleRelatedRecords =
          activity.ticket_id !== null &&
          (activity.lead_id !== null || activity.deal_id !== null);
        row.dataset.relatedNeedsCorrection = String(hasMultipleRelatedRecords);
        if (isOverdue) row.classList.add("activity-overdue-row");
        const nameCell = document.createElement("td");
        nameCell.className = "fw-semibold activity-name-cell";
        nameCell.textContent = activity.activity_name || "";
        nameCell.title = nameCell.textContent;
        const customerCell = document.createElement("td");
        customerCell.className = "activity-customer-cell";
        customerCell.textContent = activity.customer_name || "—";
        customerCell.title = customerCell.textContent;
        const relatedCell = document.createElement("td");
        relatedCell.className = "activity-related-cell";
        const relatedLabels = [];
        if (activity.lead_id !== null) {
          relatedLabels.push(
            crmActivityRecordLabel(
              "Lead",
              activity.lead_name,
              activity.lead_id,
            ),
          );
        }
        if (activity.deal_id !== null) {
          relatedLabels.push(
            crmActivityRecordLabel(
              "Deal",
              activity.deal_name,
              activity.deal_id,
            ),
          );
        }
        if (activity.ticket_id !== null) {
          relatedLabels.push(
            crmActivityRecordLabel(
              "Ticket",
              activity.ticket_name,
              activity.ticket_id,
            ),
          );
        }
        if (relatedLabels.length === 0) {
          relatedLabels.push(
            crmActivityRecordLabel(
              "Contact",
              activity.customer_name,
              activity.contact_id,
            ),
          );
        }
        relatedCell.textContent = relatedLabels.join("; ");
        relatedCell.title = relatedCell.textContent;
        const typeCell = document.createElement("td");
        typeCell.className = "activity-type-cell";
        typeCell.textContent = activity.activity_type || "";
        const dateCell = document.createElement("td");
        dateCell.className = "activity-due-date-cell";
        const dueDate = document.createElement("span");
        dueDate.className = "activity-due-date";
        dueDate.textContent = activity.due_date || "";
        dateCell.appendChild(dueDate);
        if (isOverdue) {
          const overdueLabel = document.createElement("span");
          overdueLabel.className = "activity-overdue-label";
          overdueLabel.textContent = "Overdue";
          dateCell.appendChild(overdueLabel);
        }
        const statusCell = document.createElement("td");
        statusCell.className = "activity-status-cell";
        const statusBadge = document.createElement("span");
        statusBadge.className = "tablebadge";
        statusBadge.dataset.status = activity.status || "";
        statusBadge.textContent = activity.status || "";
        statusCell.appendChild(statusBadge);
        const staffCell = document.createElement("td");
        staffCell.className = "activity-staff-cell";
        staffCell.textContent = activity.assigned_staff_name || "—";
        staffCell.title = staffCell.textContent;
        const department =
          activity.ticket_id !== null
            ? "Customer Service Staff"
            : "Sales Staff";
        const needsCorrection =
          hasMultipleRelatedRecords ||
          activity.assigned_staff_status !== "Active" ||
          activity.assigned_staff_role !== department;
        if (needsCorrection) {
          const warning = document.createElement("span");
          warning.className = "badge text-bg-warning ms-2";
          warning.title = hasMultipleRelatedRecords
            ? "Choose exactly one related Lead, Deal, or Ticket to correct this activity."
            : `Assigned user must be an active ${department} user.`;
          warning.textContent = "Needs correction";
          staffCell.appendChild(warning);
          row.dataset.assignmentNeedsCorrection = "true";
        } else {
          row.dataset.assignmentNeedsCorrection = "false";
        }
        const actionsCell = document.createElement("td");
        actionsCell.className = "activity-actions-cell";
        const actions = document.createElement("div");
        actions.className = "d-flex align-items-center gap-3";
        [
          ["View", "action-btn-view", "viewActivityModal"],
          ["Edit", "action-btn-edit", "editActivityModal"],
          ["Delete", "action-btn-delete", "deleteActivityModal"],
        ].forEach(([label, className, modalId]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `btn btn-link p-0 text-decoration-none ${className}`;
          button.dataset.bsToggle = "modal";
          button.dataset.bsTarget = `#${modalId}`;
          button.textContent = label;
          actions.appendChild(button);
        });
        actionsCell.appendChild(actions);
        row.append(
          nameCell,
          customerCell,
          relatedCell,
          typeCell,
          dateCell,
          statusCell,
          staffCell,
          actionsCell,
        );
        tbody.appendChild(row);
      });
    }
    renderStaticStatusBadges();
    window.initTableSearchAndFilters();
  } catch (error) {
    console.error("Activities load failed:", error);
    crmActivityStateRow(
      tbody,
      error.message || "Unable to load activities. Refresh and try again.",
      "text-danger",
    );
    crmShowActivityNotice(
      error.message || "Unable to load activities. Refresh and try again.",
      "danger",
    );
  } finally {
    delete table.dataset.activitiesLoading;
  }
}
async function crmSendActivityAction(action, formData, table) {
  const tokenResponse = await fetch("activities-api.php?action=list", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const tokenData = await tokenResponse.json();
  if (
    !tokenResponse.ok ||
    !tokenData.success ||
    typeof tokenData.csrf_token !== "string" ||
    !tokenData.csrf_token
  ) {
    throw new Error(
      tokenData.message || "Unable to verify the Activities security token.",
    );
  }
  table.dataset.csrfToken = tokenData.csrf_token;
  formData.set("csrf_token", tokenData.csrf_token);
  const response = await fetch(
    `activities-api.php?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": tokenData.csrf_token,
      },
      body: formData,
    },
  );
  const data = await response.json();
  return { response, data };
}
if (!window.__crmActivityFormsBound) {
  window.__crmActivityFormsBound = true;
  document.addEventListener("shown.bs.modal", (event) => {
    if (
      ![
        "addActivityModal",
        "editActivityModal",
        "deleteActivityModal",
      ].includes(event.target.id)
    )
      return;
    event.target
      .querySelectorAll(".activity-api-form-notice")
      .forEach((notice) => notice.remove());
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    const formId = form && form.getAttribute && form.getAttribute("id");
    const actions = {
      addActivityForm: "create",
      editActivityForm: "update",
      deleteActivityForm: "delete",
    };
    const action = actions[formId];
    if (!action) return;
    event.preventDefault();
    if (form.dataset.submitting === "true") return;
    const table = document.getElementById("activitiesTable");
    if (!table) {
      crmShowActivityFormMessage(
        form,
        "The Activities page is no longer available. Reopen it and try again.",
        "danger",
      );
      return;
    }
    if (action !== "delete") {
      const missingDropdown = Array.from(
        form.querySelectorAll('.dropdown[data-required="true"]'),
      ).find((dropdown) => {
        const input = dropdown.querySelector('input[type="hidden"]');
        const missing = !input || !input.value;
        const toggle = dropdown.querySelector(".custom-dropdown-toggle");
        if (toggle) toggle.classList.toggle("dd-invalid", missing);
        return missing;
      });
      const hasLeadOrDeal = Boolean(crmActivityValue(form, "lead_deal_id"));
      const hasTicket = Boolean(crmActivityValue(form, "ticket_id"));
      if (
        !form.checkValidity() ||
        missingDropdown ||
        hasLeadOrDeal === hasTicket
      ) {
        form.reportValidity();
        const message =
          hasLeadOrDeal === hasTicket
            ? "Choose exactly one related Lead, Deal, or Ticket; the current database requires one."
            : missingDropdown
              ? "Complete all required fields and select an assigned staff member."
              : "Complete the required activity fields before saving.";
        crmShowActivityFormMessage(form, message, "warning");
        return;
      }
    }
    form.dataset.submitting = "true";
    const submitButton =
      event.submitter ||
      document.querySelector(`[form="${formId}"][type="submit"]`) ||
      form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    form.parentElement
      .querySelectorAll(".activity-api-form-notice")
      .forEach((notice) => notice.remove());
    try {
      const { response, data } = await crmSendActivityAction(
        action,
        new FormData(form),
        table,
      );
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to process this activity.");
      }
      if (document.getElementById("activitiesTable") !== table) return;
      const modal = form.closest(".modal");
      if (modal && window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modal).hide();
        if (action !== "delete") crmResetModal(modal);
      }
      await crmLoadActivities(table);
      crmShowActivityNotice(
        data.message || "Activity operation completed.",
        "success",
      );
    } catch (error) {
      console.error("Activity operation failed:", error);
      crmShowActivityFormMessage(
        form,
        error.message || "Unable to process this activity. Please try again.",
        "danger",
      );
    } finally {
      delete form.dataset.submitting;
      if (submitButton) submitButton.disabled = false;
    }
  });
}
// Activity page handlers.
if (!window.__crmActivityButtonsBound) {
  window.__crmActivityButtonsBound = true;
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(
      "#activitiesTable .action-btn-view, #activitiesTable .action-btn-edit, #activitiesTable .action-btn-delete",
    );
    if (!btn) return;
    const row = btn.closest("tr:not(.empty-data-row)");
    if (!row) return;

    const t = (i) => (row.cells[i] ? row.cells[i].textContent.trim() : "");
    // Empty values indicate no linked record.
    const linked = (v) => (!v || v === "—" || v === "-" ? "Not linked" : v);
    const d = row.dataset;

    const item = {
      id: d.id || "",
      name: t(0),
      customer: t(1),
      leadDeal: linked(t(2)),
      type: t(3),
      dateText: t(4),
      date: d.date || "",
      status: t(5),
      staff: t(6),
      customerId: d.customerId || "",
      leadId: d.leadId || "",
      dealId: d.dealId || "",
      relatedValue: d.relatedValue || "",
      relatedType: d.relatedType || "",
      relatedNeedsCorrection: d.relatedNeedsCorrection === "true",
      ticket: linked(d.ticket || ""),
      ticketId: d.ticketId || "",
      staffId: d.staffId || "",
      staffRole: d.staffRole || "",
      staffStatus: d.staffStatus || "",
      assignmentNeedsCorrection: d.assignmentNeedsCorrection === "true",
      notes: d.notes || "",
    };

    if (btn.classList.contains("action-btn-view")) {
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text || "-";
      };
      set("viewActivityName", item.name);
      set("viewActivityType", item.type);
      set("viewActivityDate", item.dateText);
      set("viewActivityNotes", item.notes);
      set("viewActivityCustomer", item.customer);
      set("viewActivityLeadDeal", item.leadDeal);
      set("viewActivityTicket", item.ticket);
      set("viewActivityStaff", item.staff);
      const statusBox = document.getElementById("viewActivityStatus");
      if (statusBox)
        statusBox.innerHTML = getStatusBadgeHTML(item.status) || "-";
      return;
    }

    if (btn.classList.contains("action-btn-delete")) {
      crmSetText2("#deleteActivityModal strong", item.name || "");
      const idInput = document.querySelector(
        '#deleteActivityModal input[name="id"]',
      );
      if (idInput) idInput.value = item.id;
      return;
    }

    const modal = document.getElementById("editActivityModal");
    if (!modal) return;
    const dd = (field) =>
      modal.querySelector('.dropdown[data-field="' + field + '"]');
    crmSetValue(modal, "id", item.id);
    crmSetValue(modal, "activity_name", item.name);
    crmSetValue(modal, "due_date", item.date);
    crmSetValue(modal, "notes", item.notes);
    crmSelectDropdown(dd("customer_id"), item.customer, item.customerId);
    crmActivityFilterRelatedOptions(modal.querySelector("form"));
    crmSelectDropdown(
      dd("lead_deal_id"),
      item.relatedType === "Lead" || item.relatedType === "Deal"
        ? item.leadDeal
        : "Not linked",
      item.relatedValue && item.relatedValue.includes(":")
        ? item.relatedValue
        : "",
    );
    crmSelectDropdown(
      dd("ticket_id"),
      item.relatedType === "Ticket" ? item.ticket : "Not linked",
      item.relatedType === "Ticket" ? item.ticketId : "",
    );
    crmSelectDropdown(dd("activity_type"), item.type);
    crmSelectDropdown(dd("status"), item.status);
    const assignmentWarning = document.getElementById(
      "editActivityAssignmentWarning",
    );
    const department =
      item.relatedType === "Ticket" ? "Customer Service Staff" : "Sales Staff";
    const assignmentNeedsCorrection =
      item.assignmentNeedsCorrection ||
      item.staffRole !== department ||
      item.staffStatus !== "Active" ||
      item.relatedNeedsCorrection;
    const activityForm = modal.querySelector("form");
    if (item.relatedNeedsCorrection) {
      crmActivityClearDropdown(dd("lead_deal_id"), "Not linked");
      crmActivityClearDropdown(dd("ticket_id"), "Not linked");
      crmActivityUpdateStaffOptions(
        activityForm,
        "",
        "This activity is linked to multiple department records. Choose exactly one Lead, Deal, or Ticket, then select the matching department staff.",
      );
    } else {
      crmActivityUpdateStaffOptions(
        activityForm,
        assignmentNeedsCorrection ? "" : item.staffId,
        assignmentNeedsCorrection
          ? `This activity is assigned to ${item.staff || "an inactive or ineligible user"}. Select an active ${department} user to correct the assignment.`
          : "",
      );
    }
    if (assignmentWarning && !assignmentNeedsCorrection)
      assignmentWarning.classList.add("d-none");
    modal.querySelectorAll("textarea[maxlength]").forEach(crmUpdateCharCount);
    crmTakeSnapshot("editActivityModal");
    crmSetText2(
      "#discardActivityChangesModal strong.text-highlight",
      item.name || "",
    );
  });
}

// Keep opened dropdown lists visible inside modals.
if (!window.__crmDropdownAutoScrollBound) {
  window.__crmDropdownAutoScrollBound = true;

  // Bootstrap emits shown.bs.dropdown after the menu opens.
  document.addEventListener("shown.bs.dropdown", function (e) {
    const dropdown = e.target.closest ? e.target.closest(".dropdown") : null;
    if (!dropdown) return;
    const menu = dropdown.querySelector(".dropdown-menu");
    const body = menu ? menu.closest(".modal-body") : null;
    if (!body) return; // Limit scrolling to modal dropdowns.

    // Wait one frame for the menu to finish sizing.
    requestAnimationFrame(function () {
      const gap = 12; // Leave space below the menu.
      const menuBox = menu.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const toggleBox = e.target.getBoundingClientRect();

      let amount = menuBox.bottom - bodyBox.bottom + gap; // Hidden menu height.
      if (amount <= 0) return; // The menu is already visible.

      // Keep the dropdown button visible while scrolling.
      amount = Math.min(amount, toggleBox.top - bodyBox.top - 8);
      if (amount > 0) body.scrollBy({ top: amount, behavior: "smooth" });
    });
  });
}
