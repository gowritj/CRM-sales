import { api } from "./modules/api.js";
import { avatar, badge, esc, initials, monthlyCallVolume, money, personCell, statusClass } from "./modules/formatters.js";

const app = document.getElementById("app");
const mobileRoute = location.pathname === "/mobile";
const state = {
  user: null,
  page: "dashboard",
  data: {},
  dashboard: {},
  search: "",
  filters: { leads: "All statuses" },
  leadPage: 1,
  leadPageSize: 10,
  leadPageRows: [],
  leadPagination: { total: 0, page: 1, pageSize: 10 },
  selectedLeadIds: new Set(),
  chartPeriod: "week",
  moreOpen: false,
  searchTimer: null
};

const navigation = [
  { id: "dashboard", label: "Dashboard", icon: "⌂", roles: ["admin", "staff"] },
  { id: "leads", label: "Lead management", icon: "♧", roles: ["admin", "staff"] },
  { id: "followups", label: "Follow-ups", icon: "◷", roles: ["admin", "staff"] },
  { id: "applications", label: "Loan applications", icon: "▣", roles: ["admin", "staff"] },
  { id: "documents", label: "Documents", icon: "▤", roles: ["admin", "staff"] },
  { id: "team", label: "Team & targets", icon: "♙", roles: ["admin"] },
  { id: "banks", label: "Banks & schemes", icon: "⌂", roles: ["admin"] },
  { id: "reports", label: "Reports", icon: "▥", roles: ["admin"] }
];

const pageMeta = {
  dashboard: ["Dashboard", "Here’s what’s happening with your loan pipeline today."],
  leads: ["Lead management", "Track prospects, assign owners, and keep every conversation moving."],
  followups: ["Follow-ups", "Stay on top of the next conversation and never miss a customer."],
  applications: ["Loan applications", "Follow each loan from bank submission to disbursement."],
  documents: ["Documents", "Review customer paperwork and keep applications moving."],
  team: ["Team & targets", "Manage your advisors, daily call targets, and team activity."],
  banks: ["Banks & schemes", "Manage lending partners and the products they offer."],
  reports: ["Reports & analytics", "A clear view of your team’s pipeline and performance."]
};

const findLead = (id) => (state.data.leads || []).find((lead) => lead.id === id);
const findEmployee = (id) => (state.data.employees || []).find((employee) => employee.id === id);
const findBank = (id) => (state.data.banks || []).find((bank) => bank.id === id);

async function loadData() {
  const tables = state.user.role === "admin"
    ? ["leads", "employees", "banks", "schemes", "applications", "documents", "calls", "followups"]
    : ["leads", "employees", "banks", "schemes", "applications", "documents", "calls", "followups"];
  const results = await Promise.all([...tables.map((table) => api(`/api/${table}`)), api("/api/dashboard")]);
  tables.forEach((table, index) => { state.data[table] = results[index]; });
  state.dashboard = results[results.length - 1];
  if (!state.data.banks) state.data.banks = [];
  if (!state.data.schemes) state.data.schemes = [];
  if (state.page === "leads") await loadLeadPage();
}

async function loadLeadPage() {
  const params = new URLSearchParams({
    page: String(state.leadPage),
    pageSize: String(state.leadPageSize),
    search: state.search,
    status: state.filters.leads === "All statuses" ? "" : state.filters.leads
  });
  const response = await fetch(`/api/leads?${params}`, { credentials: "same-origin" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  state.leadPageRows = body;
  state.leadPagination = {
    total: Number(response.headers.get("X-Total-Count") || body.length),
    page: Number(response.headers.get("X-Page") || state.leadPage),
    pageSize: Number(response.headers.get("X-Page-Size") || state.leadPageSize)
  };
}

function showLogin(errorMessage = "") {
  document.body.classList.remove("mobile");
  app.innerHTML = `
    <main class="login-screen">
      <section class="login-visual">
        <div class="brand"><div class="brand-mark">n</div><div class="brand-name">northstar<span class="brand-sub">lending made clear</span></div></div>
        <div class="login-headline">
          <h1>Every lead.<br>One clear path.</h1>
          <p>Bring your team, conversations, and loan applications together — and make every customer feel taken care of.</p>
          <div class="login-stats"><div><strong>2.4k</strong><span>Customers helped</span></div><div><strong>94%</strong><span>On-time follow-ups</span></div><div><strong>4.8★</strong><span>Customer rating</span></div></div>
        </div>
        <div class="login-footer">© 2026 Northstar Lending · A calmer way to move forward.</div>
      </section>
      <section class="login-panel">
        <form class="login-box" data-form="login">
          <div class="brand" style="padding:0 0 25px"><div class="brand-mark">n</div><div class="brand-name" style="color:#17213a">northstar<span class="brand-sub">lending made clear</span></div></div>
          <h2>Welcome back</h2><p>Sign in to your Northstar workspace.</p>
          ${errorMessage ? `<div class="login-error">${esc(errorMessage)}</div>` : ""}
          <div class="field"><label for="login-email">Work email</label><input id="login-email" name="email" type="email" placeholder="you@company.com" value="admin@northstar.demo" required autocomplete="username"></div>
          <div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" placeholder="Enter your password" value="admin123" required autocomplete="current-password"></div>
          <button class="btn btn-primary login-submit" type="submit">Sign in <span>→</span></button>
          <div class="demo-credentials"><strong>Try the demo</strong>
            <div class="demo-credential-row"><span>Admin</span><code>admin@northstar.demo · admin123</code><button class="action-link" type="button" data-action="fill-demo" data-email="admin@northstar.demo" data-password="admin123">Use</button></div>
            <div class="demo-credential-row"><span>Staff</span><code>staff@northstar.demo · staff123</code><button class="action-link" type="button" data-action="fill-demo" data-email="staff@northstar.demo" data-password="staff123">Use</button></div>
          </div>
        </form>
      </section>
    </main>`;
}

function renderShell() {
  document.body.classList.toggle("mobile", mobileRoute);
  const accessible = navigation.filter((item) => item.roles.includes(state.user.role));
  const active = pageMeta[state.page] || pageMeta.dashboard;
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">n</div><div class="brand-name">northstar<span class="brand-sub">loan sales crm</span></div></div>
        <div class="nav-caption">Workspace</div>
        <nav class="nav-list" aria-label="Main navigation">
          ${accessible.map((item) => `<button class="nav-item ${state.page === item.id ? "active" : ""}" data-page="${item.id}" title="${esc(item.label)}"><span class="nav-icon">${item.icon}</span><span>${esc(item.label)}</span>${item.id === "leads" && state.dashboard.newLeads ? `<span class="nav-count">${state.dashboard.newLeads}</span>` : ""}</button>`).join("")}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-footer">
          <div class="sidebar-tip"><strong>Good service, on time.</strong>Keep each customer updated as their application moves forward.</div>
          <button class="nav-item" data-action="change-password"><span class="nav-icon">⌑</span><span>Change password</span></button>
          <button class="nav-item" data-action="logout"><span class="nav-icon">↪</span><span>Sign out</span></button>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <div class="crumbs">Workspace&nbsp; / &nbsp;<b>${esc(active[0])}</b></div>
          <label class="topbar-search"><span class="search-glass">⌕</span><input id="global-search" type="search" placeholder="Search customers, applications…" value="${esc(state.search)}" aria-label="Search"></label>
          <button class="icon-button" title="Notifications" data-action="notifications">♧<span class="notification-dot"></span></button>
          <button class="profile-button" data-action="profile">${avatar(state.user.name, state.user.color)}<span class="profile-text">${esc(state.user.name)}<small>${state.user.role === "admin" ? "Administrator" : "Loan advisor"}</small></span></button>
        </header>
        <div class="page-wrap">
          ${mobileRoute ? `<div class="mobile-banner"><span>▣</span> You’re viewing the mobile admin experience. All portal features are available here.<a href="/">Desktop view</a></div>` : ""}
          <section id="page-content">${renderPage()}</section>
        </div>
      </main>
      <nav class="mobile-bottom-nav" aria-label="Mobile navigation">${accessible.slice(0, 4).map((item) => `<button class="${state.page === item.id ? "active" : ""}" data-page="${item.id}"><span>${item.icon}</span><span>${esc(item.label.replace(" management", "").replace(" applications", ""))}</span></button>`).join("")}<button class="${state.moreOpen ? "active" : ""}" data-action="more"><span>•••</span><span>More</span></button></nav>
      ${mobileRoute && state.moreOpen ? renderMoreSheet(accessible) : ""}
    </div>`;
}

function renderMoreSheet(accessible) {
  return `<div class="more-backdrop" data-action="close-more"><section class="more-sheet" role="dialog" aria-modal="true" aria-label="More navigation"><div class="more-sheet-grip"></div><div class="more-sheet-heading">More</div>${accessible.slice(4).map((item) => `<button class="more-item" data-page="${item.id}"><span>${item.icon}</span>${esc(item.label)}</button>`).join("")}<button class="more-item" data-action="change-password"><span>⌑</span>Change password</button><button class="more-item" data-action="logout"><span>↪</span>Sign out</button></section></div>`;
}

function heading(title, subtitle, actions = "") {
  return `<div class="page-heading"><div><h1 class="page-title">${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function renderPage() {
  const renderers = { dashboard: renderDashboard, leads: renderLeads, followups: renderFollowups, applications: renderApplications, documents: renderDocuments, team: renderTeam, banks: renderBanks, reports: renderReports };
  return (renderers[state.page] || renderDashboard)();
}

function renderDashboard() {
  const d = state.dashboard;
  const admin = state.user.role === "admin";
  const completion = Math.min(100, Math.round(d.callsToday / Math.max(1, d.target) * 100));
  const today = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const statCards = admin ? [
    ["Total leads", d.leads, `${d.newLeadsThisWeek} new this week`, "♧", "blue"],
    ["Interested", d.interested, `${d.conversionRate}% converted`, "♥", "green"],
    ["Active follow-ups", d.followups, `${d.followupsDueToday} due today`, "◷", "amber"],
    ["Approved loans", d.approved, `${d.applications} applications tracked`, "▣", "violet"]
  ] : [
    ["My assigned leads", d.leads, `${d.newLeads} new to contact`, "♧", "blue"],
    ["Calls completed", `${d.callsToday} / ${d.target}`, `${completion}% of daily target`, "◖", "green"],
    ["Interested customers", d.interested, "Keep the momentum going", "♥", "amber"],
    ["Follow-ups due", d.followups, `${d.applications} applications to track`, "◷", "violet"]
  ];
  const team = (state.data.employees || []).slice(0, 5);
  const chart = state.chartPeriod === "month" ? monthlyCallVolume(state.data.calls || []) : d.callVolume || [];
  const maxCall = Math.max(...chart.map((item) => item.calls), 1);
  return `${heading(`Good morning, ${state.user.name.split(" ")[0]} 👋`, admin ? `Here’s your team's snapshot for today, ${today}.` : `Here’s your personal snapshot for today, ${today}.`, `<button class="btn" data-action="export">⇩ Export</button>${admin ? `<button class="btn btn-primary" data-action="new-lead">＋ Add new lead</button>` : `<button class="btn btn-primary" data-action="new-call">＋ Log a call</button>`}`)}
    <div class="stats-grid">${statCards.map(([label, value, foot, icon, tint]) => `<article class="stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon tint-${tint}">${icon}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-foot"><span class="${foot.includes("↗") ? "trend" : ""}">${esc(foot)}</span></div></article>`).join("")}</div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Call activity</h2><span class="panel-subtitle">${state.chartPeriod === "month" ? "Calls over the last four weeks" : "Calls over the last seven days"}</span></div><select class="select-inline" id="call-period" aria-label="Activity period"><option value="week" ${state.chartPeriod === "week" ? "selected" : ""}>This week</option><option value="month" ${state.chartPeriod === "month" ? "selected" : ""}>This month</option></select></div>
        <div class="chart-area">${chart.map((item) => `<div class="chart-day"><div class="bar-pair"><div class="bar main" style="height:${Math.max(6, item.calls / maxCall * 140)}px" title="${item.calls} calls on ${esc(item.date)}"></div></div><span>${esc(item.day)}</span></div>`).join("")}</div><div class="chart-legend"><span><i class="legend-dot"></i>Calls logged</span></div>
      </section>
      <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">${admin ? "Team call targets" : "Today’s target"}</h2><span class="panel-subtitle">${admin ? "Daily progress across your team" : `${completion}% complete · ${Math.max(0, d.target - d.callsToday)} calls to go`}</span></div><button class="action-link" data-page="${admin ? "team" : "leads"}">${admin ? "View team →" : "My leads →"}</button></div>
        ${admin ? team.map((employee) => {
          const metric = (d.employeeMetrics || []).find((item) => item.id === employee.id) || { callsToday: 0, target: employee.target, progress: 0 };
          const remaining = Math.max(0, metric.target - metric.callsToday);
          const callLabel = metric.callsToday >= metric.target ? "Target reached" : `${remaining} to go`;
          return `<div class="target-card"><div class="target-head">${avatar(employee.name)}<div><div class="target-name">${esc(employee.name)}</div><div class="target-role">${esc(employee.role)}</div></div><span class="target-count">${metric.callsToday}<small style="font:400 9px 'DM Sans';color:#9aa4b6"> / ${metric.target}</small></span></div><div class="progress-track"><div class="progress-bar" style="width:${metric.progress}%"></div></div><div class="progress-meta"><span>${metric.progress}% of daily target</span><span>${employee.status === "Active" ? callLabel : esc(employee.status)}</span></div></div>`;
        }).join("") : `<div class="target-card"><div class="target-head">${avatar(state.user.name)}<div><div class="target-name">${esc(state.user.name)}</div><div class="target-role">Daily call goal</div></div><span class="target-count">${d.callsToday}<small style="font:400 9px 'DM Sans';color:#9aa4b6"> / ${d.target}</small></span></div><div class="progress-track"><div class="progress-bar" style="width:${completion}%"></div></div><div class="progress-meta"><span>${completion}% of daily target</span><span>${completion >= 100 ? "Target reached" : `${d.target - d.callsToday} to go`}</span></div></div><p class="form-help">Consistent follow-ups help customers move forward with confidence.</p>`}
      </section>
    </div>
    ${renderRecentLeads()}`;
}

function renderRecentLeads() {
  const recent = [...(state.data.leads || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 6);
  return `<section class="table-card"><div class="table-heading"><div><h2 class="panel-title">Recent leads</h2><span class="panel-subtitle">Your latest customer conversations</span></div><button class="action-link" data-page="leads">View all leads →</button></div>
    <div class="table-scroll"><table><thead><tr><th>Customer</th><th>Loan type</th><th>Requested amount</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody>${recent.map((lead) => `<tr><td>${personCell(lead.name, lead.phone)}</td><td>${esc(lead.loanType)}</td><td>${money(lead.amount)}</td><td>${esc(findEmployee(lead.assigneeId)?.name || "Unassigned")}</td><td>${badge(lead.status)}</td><td><button class="action-link" data-action="edit-lead" data-id="${esc(lead.id)}">View</button></td></tr>`).join("")}</tbody></table></div></section>`;
}

function filterRows(rows, searchable) {
  let filtered = rows;
  if (state.search.trim()) {
    const query = state.search.toLowerCase();
    filtered = filtered.filter((row) => searchable(row).toLowerCase().includes(query));
  }
  return filtered;
}

function renderLeads() {
  const leads = state.leadPageRows || [];
  const statusFilter = state.filters.leads || "All statuses";
  const total = state.leadPagination.total;
  const pageSize = state.leadPagination.pageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = leads;
  const selectedCount = state.selectedLeadIds.size;
  const allPageSelected = pageRows.length > 0 && pageRows.every((lead) => state.selectedLeadIds.has(lead.id));
  return `${heading("Lead management", "Track prospects, assign owners, and keep every conversation moving.", `<button class="btn" data-action="import-csv">⇧ Import CSV</button><button class="btn" data-action="export">⇩ Export</button><button class="btn btn-primary" data-action="new-lead">＋ Add lead</button>`)}
    <section class="table-card"><div class="table-heading"><div><h2 class="panel-title">All leads <span style="color:#99a3b4;font-weight:400">(${total})</span></h2></div><div class="filter-row"><select class="filter-select" id="lead-status-filter"><option>All statuses</option>${["New", "Interested", "Follow-up", "Documents", "Not interested", "Converted"].map((item) => `<option ${statusFilter === item ? "selected" : ""}>${item}</option>`).join("")}</select>${state.user.role === "admin" ? `<button class="btn btn-sm" data-action="distribute">⇄ Distribute leads</button><button class="btn btn-sm" data-action="reassign-selected" ${selectedCount ? "" : "disabled"}>Reassign selected (${selectedCount})</button>` : ""}</div></div>
    <div class="table-scroll"><table><thead><tr>${state.user.role === "admin" ? `<th><input type="checkbox" class="lead-select-all" ${allPageSelected ? "checked" : ""} aria-label="Select leads on this page"></th>` : ""}<th>Customer</th><th>Loan request</th><th>Source</th><th>Assigned to</th><th>Priority</th><th>Status</th><th>Last contact</th><th>Actions</th></tr></thead><tbody>${pageRows.length ? pageRows.map((lead) => `<tr>${state.user.role === "admin" ? `<td><input type="checkbox" class="lead-select" data-id="${esc(lead.id)}" ${state.selectedLeadIds.has(lead.id) ? "checked" : ""} aria-label="Select ${esc(lead.name)}"></td>` : ""}<td>${personCell(lead.name, lead.phone)}</td><td><div class="person-name">${esc(lead.loanType)}</div><div class="person-detail">${money(lead.amount)}</div></td><td>${esc(lead.source || "—")}</td><td>${state.user.role === "admin" ? `<select class="filter-select assign-select" data-id="${esc(lead.id)}" aria-label="Assign ${esc(lead.name)}"><option value="">Unassigned</option>${(state.data.employees || []).filter((employee) => employee.active).map((employee) => `<option value="${esc(employee.id)}" ${lead.assigneeId === employee.id ? "selected" : ""}>${esc(employee.name)}</option>`).join("")}</select>` : esc(findEmployee(lead.assigneeId)?.name || "You")}</td><td>${badge(lead.priority || "Medium")}</td><td>${badge(lead.status)}</td><td>${esc(lead.lastContact || "Not contacted")}</td><td><button class="action-link" data-action="log-call" data-id="${esc(lead.id)}">Call</button><button class="action-link" data-action="upload-lead-document" data-lead-id="${esc(lead.id)}">Document</button><button class="action-link" data-action="edit-lead" data-id="${esc(lead.id)}">Edit</button></td></tr>`).join("") : `<tr><td colspan="${state.user.role === "admin" ? 9 : 8}"><div class="empty-state"><strong>No leads found</strong>Try another search or add your first lead.</div></td></tr>`}</tbody></table></div>
    <div class="pagination"><span>Showing ${total ? (state.leadPage - 1) * pageSize + 1 : 0}–${Math.min(total, state.leadPage * pageSize)} of ${total} leads</span><span class="pagination-buttons"><button data-action="lead-page" data-value="-1" aria-label="Previous page" ${state.leadPage <= 1 ? "disabled" : ""}>‹</button><button>${state.leadPage} / ${pages}</button><button data-action="lead-page" data-value="1" aria-label="Next page" ${state.leadPage >= pages ? "disabled" : ""}>›</button></span></div></section>`;
}

function renderFollowups() {
  const rows = filterRows(state.data.followups || [], (item) => [findLead(item.leadId)?.name, item.note, item.status, findEmployee(item.employeeId)?.name].join(" "));
  rows.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  return `${heading("Follow-ups", "Stay on top of the next conversation and never miss a customer.", `<button class="btn btn-primary" data-action="new-followup">＋ Schedule follow-up</button>`)}
    <div class="stats-grid">${[["Open follow-ups", rows.filter((item) => item.status !== "Completed").length, "Across your active pipeline", "◷", "blue"], ["Due today", rows.filter((item) => new Date(item.dueAt).toDateString() === new Date().toDateString() && item.status !== "Completed").length, "Prioritize these conversations", "◉", "amber"], ["Completed", rows.filter((item) => item.status === "Completed").length, "Great work staying connected", "✓", "green"], ["Overdue", rows.filter((item) => item.status === "Overdue" || (new Date(item.dueAt) < new Date() && item.status !== "Completed")).length, "Give these customers a call", "!", "violet"]].map(([label, value, foot, icon, color]) => `<article class="stat-card"><div class="stat-top">${label}<span class="stat-icon tint-${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`).join("")}</div>
    <section class="table-card"><div class="table-heading"><h2 class="panel-title">Follow-up schedule</h2><span class="panel-subtitle">${rows.length} scheduled conversations</span></div><div class="table-scroll"><table><thead><tr><th>Customer</th><th>Due</th><th>Owner</th><th>Note</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.length ? rows.map((item) => `<tr><td>${personCell(findLead(item.leadId)?.name || "Customer", findLead(item.leadId)?.phone || "")}</td><td>${new Date(item.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td><td>${esc(findEmployee(item.employeeId)?.name || "—")}</td><td>${esc(item.note)}</td><td>${badge(item.status)}</td><td>${item.status !== "Completed" ? `<button class="action-link" data-action="complete-followup" data-id="${esc(item.id)}">Mark done</button>` : `<span class="person-detail">Completed</span>`}</td></tr>`).join("") : `<tr><td colspan="6"><div class="empty-state"><strong>Nothing on the calendar</strong>Schedule a follow-up to keep a lead moving.</div></td></tr>`}</tbody></table></div></section>`;
}

function renderApplications() {
  const rows = filterRows(state.data.applications || [], (item) => [findLead(item.leadId)?.name, findBank(item.bankId)?.name, item.status, item.id].join(" "));
  return `${heading("Loan applications", "Follow each loan from bank submission to disbursement.", `<button class="btn btn-primary" data-action="new-application">＋ New application</button>`)}
    <div class="stats-grid">${[["In progress", rows.filter((item) => !["Disbursed", "Rejected", "Closed"].includes(item.status)).length, "With partner banks", "◷", "blue"], ["Under review", rows.filter((item) => item.status === "Under review").length, "Waiting on the bank", "◌", "amber"], ["Approved", rows.filter((item) => item.status === "Approved").length, "Ready to close", "✓", "green"], ["Disbursed", rows.filter((item) => item.status === "Disbursed").length, "Successfully completed", "▣", "violet"]].map(([label, value, foot, icon, color]) => `<article class="stat-card"><div class="stat-top">${label}<span class="stat-icon tint-${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`).join("")}</div>
    <section class="table-card"><div class="table-heading"><h2 class="panel-title">Application pipeline (${rows.length})</h2><div class="filter-row"><select class="filter-select" id="application-status-filter"><option>All statuses</option>${["Documents pending", "Submitted", "Under review", "Approved", "Rejected", "Disbursed", "Closed"].map((status) => `<option>${status}</option>`).join("")}</select></div></div>
    <div class="table-scroll"><table><thead><tr><th>Application</th><th>Customer</th><th>Bank / scheme</th><th>Loan amount</th><th>Updated</th><th>Stage</th><th>Actions</th></tr></thead><tbody>${rows.map((item) => `<tr><td><span class="person-name">#${esc(item.id.slice(-4).toUpperCase())}</span></td><td>${personCell(findLead(item.leadId)?.name || "Customer", findLead(item.leadId)?.loanType || "")}</td><td><div class="person-name">${esc(findBank(item.bankId)?.name || "—")}</div><div class="person-detail">${esc((state.data.schemes || []).find((scheme) => scheme.id === item.schemeId)?.name || "")}</div></td><td>${money(item.amount || findLead(item.leadId)?.amount)}</td><td>${esc(item.updatedAt || "—")}</td><td>${badge(item.status)}</td><td><button class="action-link" data-action="application-history" data-id="${esc(item.id)}">History</button><button class="action-link" data-action="edit-application" data-id="${esc(item.id)}">${state.user.role === "admin" ? "Update stage" : "Add remarks"}</button></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty-state"><strong>No applications yet</strong>Create an application to start tracking a loan.</div></td></tr>`}</tbody></table></div></section>`;
}

function renderDocuments() {
  const rows = filterRows(state.data.documents || [], (item) => [findLead(item.leadId)?.name, item.name, item.fileName, item.type, item.status].join(" "));
  const admin = state.user.role === "admin";
  return `${heading("Documents", "Review customer paperwork and keep applications moving.", `<button class="btn btn-primary" data-action="upload-document">⇧ Upload document</button>`)}
    <div class="stats-grid">${[["Total documents", rows.length, "Across active applications", "▤", "blue"], ["Pending review", rows.filter((item) => item.status === "Pending review").length, "Needs your attention", "◷", "amber"], ["Verified", rows.filter((item) => item.status === "Verified").length, "Ready for the bank", "✓", "green"], ["Needs attention", rows.filter((item) => item.status === "Rejected").length, "Request an updated copy", "!", "violet"]].map(([label, value, foot, icon, color]) => `<article class="stat-card"><div class="stat-top">${label}<span class="stat-icon tint-${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`).join("")}</div>
    <section class="table-card"><div class="table-heading"><h2 class="panel-title">Customer documents (${rows.length})</h2><span class="panel-subtitle">Uploaded files are private and available only to the assigned team and admins.</span></div><div class="table-scroll"><table><thead><tr><th>Document</th><th>Customer</th><th>Type</th><th>Uploaded</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map((item) => `<tr><td><div class="person-cell"><span class="stat-icon tint-blue">▤</span><div><div class="person-name">${esc(item.name)}</div><div class="person-detail">${esc(item.fileName)}</div>${item.hasFile ? `<a class="action-link" href="/api/documents/${encodeURIComponent(item.id)}/file" target="_blank" rel="noopener">View / download</a>` : ""}</div></div></td><td>${personCell(findLead(item.leadId)?.name || "Customer", findLead(item.leadId)?.loanType || "")}</td><td>${esc(item.type)}</td><td>${esc(item.uploadedAt || "—")}</td><td>${badge(item.status)}${item.rejectReason ? `<div class="person-detail">Reason: ${esc(item.rejectReason)}</div>` : ""}</td><td>${admin && item.status === "Pending review" ? `<button class="action-link" data-action="verify-document" data-id="${esc(item.id)}">Verify</button><button class="action-link" data-action="reject-document" data-id="${esc(item.id)}">Reject</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty-state"><strong>No documents found</strong>Upload a document to keep a customer’s application moving.</div></td></tr>`}</tbody></table></div></section>`;
}

function renderTeam() {
  const team = filterRows(state.data.employees || [], (employee) => [employee.name, employee.email, employee.role, employee.status].join(" "));
  const calls = state.dashboard.callsToday || 0;
  return `${heading("Team & targets", "Manage your advisors, daily call targets, and team activity.", `<button class="btn btn-primary" data-action="new-employee">＋ Add team member</button>`)}
    <div class="stats-grid">${[["Team members", team.length, "Loan advisors", "♙", "blue"], ["Daily call goal", team.filter((employee) => employee.status === "Active").reduce((sum, item) => sum + Number(item.target || 100), 0).toLocaleString(), "Calls across active advisors", "◖", "green"], ["Calls today", calls, "Activity across all advisors", "↗", "amber"], ["Active advisors", team.filter((employee) => employee.status === "Active").length, "Available for assignments", "✓", "violet"]].map(([label, value, foot, icon, color]) => `<article class="stat-card"><div class="stat-top">${label}<span class="stat-icon tint-${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`).join("")}</div>
    <section class="table-card"><div class="table-heading"><h2 class="panel-title">Advisor performance (${team.length})</h2><button class="btn btn-sm" data-action="export-employees">⇩ Export</button></div><div class="table-scroll"><table><thead><tr><th>Team member</th><th>Role</th><th>Phone</th><th>Daily target</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead><tbody>${team.map((employee) => `<tr><td>${personCell(employee.name, employee.email)}</td><td>${esc(employee.role)}</td><td>${esc(employee.phone || "—")}</td><td><span class="person-name">${Number(employee.target || 100)} calls</span><div class="progress-track" style="width:110px;margin-top:6px"><div class="progress-bar" style="width:${(state.dashboard.employeeMetrics || []).find((metric) => metric.id === employee.id)?.progress || 0}%"></div></div></td><td>${esc(employee.joined || "—")}</td><td>${badge(employee.status)}</td><td><button class="action-link" data-action="edit-employee" data-id="${esc(employee.id)}">Edit</button><button class="action-link" data-action="reset-password" data-id="${esc(employee.id)}">Reset password</button></td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderBanks() {
  const banks = filterRows(state.data.banks || [], (item) => [item.name, item.contact, item.status].join(" "));
  const schemes = filterRows(state.data.schemes || [], (item) => [item.name, findBank(item.bankId)?.name, item.tenure].join(" "));
  return `${heading("Banks & schemes", "Manage lending partners and the products they offer.", `<button class="btn" data-action="new-bank">＋ Add bank</button><button class="btn btn-primary" data-action="new-scheme">＋ Add scheme</button>`)}
    <div class="two-column"><section class="table-card"><div class="table-heading"><div><h2 class="panel-title">Bank partners (${banks.length})</h2></div></div><div class="table-scroll"><table><thead><tr><th>Bank</th><th>Contact</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>${banks.map((bank) => `<tr><td>${personCell(bank.name, bank.shortName)}</td><td>${esc(bank.contact || "—")}</td><td>${esc(bank.phone || "—")}</td><td>${badge(bank.status)}</td><td><button class="action-link" data-action="edit-bank" data-id="${esc(bank.id)}">Edit</button></td></tr>`).join("") || `<tr><td colspan="5"><div class="empty-state"><strong>No bank partners</strong>Add a bank to get started.</div></td></tr>`}</tbody></table></div></section>
    <section class="table-card"><div class="table-heading"><h2 class="panel-title">Loan schemes (${schemes.length})</h2></div><div class="table-scroll"><table><thead><tr><th>Scheme</th><th>Bank</th><th>Rate</th><th>Maximum</th></tr></thead><tbody>${schemes.map((scheme) => `<tr><td><div class="person-name">${esc(scheme.name)}</div><div class="person-detail">${esc(scheme.tenure || "")}</div></td><td>${esc(findBank(scheme.bankId)?.shortName || "—")}</td><td>${Number(scheme.rate).toFixed(1)}%</td><td>${money(scheme.maxAmount)}</td></tr>`).join("") || `<tr><td colspan="4"><div class="empty-state"><strong>No loan schemes</strong>Add a scheme to get started.</div></td></tr>`}</tbody></table></div></section></div>`;
}

function renderReports() {
  const leads = state.data.leads || [];
  const applications = state.data.applications || [];
  const calls = state.data.calls || [];
  const converted = leads.filter((lead) => lead.status === "Converted");
  const approved = applications.filter((item) => ["Approved", "Disbursed"].includes(item.status));
  const conversion = leads.length ? Math.round(converted.length / leads.length * 100) : 0;
  const team = state.data.employees || [];
  const statusCounts = ["New", "Interested", "Follow-up", "Documents", "Not interested", "Converted"].map((status) => [status, leads.filter((lead) => lead.status === status).length]);
  return `${heading("Reports & analytics", "A clear view of your team’s pipeline and performance.", `<button class="btn" data-action="export">⇩ Export lead report</button>`)}
    <div class="report-grid">${[["Total pipeline", money(leads.reduce((sum, lead) => sum + Number(lead.amount || 0), 0)), "Requested loan value"], ["Conversion rate", `${conversion}%`, `${converted.length} converted / ${leads.length} leads`], ["Approved applications", approved.length, "Approved or disbursed"], ["Calls logged", calls.length, "Recorded conversations"]].map(([label, value, foot]) => `<article class="report-card"><div class="report-label">${label}</div><div class="report-number">${value}</div><div class="report-label">${foot}</div></article>`).join("")}</div>
    <div class="two-column"><section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Pipeline by status</h2><span class="panel-subtitle">Current customer lead distribution</span></div></div>${statusCounts.map(([status, count]) => `<div class="target-card" style="padding:10px 12px"><div class="target-head"><span class="target-name">${esc(status)}</span><span class="target-count">${count}</span></div><div class="progress-track"><div class="progress-bar" style="width:${leads.length ? Math.max(count ? 5 : 0, count / leads.length * 100) : 0}%"></div></div></div>`).join("")}</section>
    <section class="panel"><div class="panel-heading"><div><h2 class="panel-title">Team overview</h2><span class="panel-subtitle">Assigned leads and recorded calls</span></div></div>${team.map((employee) => {
      const owned = leads.filter((lead) => lead.assigneeId === employee.id);
      const callCount = calls.filter((call) => call.employeeId === employee.id).length;
      return `<div class="target-card"><div class="target-head">${avatar(employee.name)}<div><div class="target-name">${esc(employee.name)}</div><div class="target-role">${owned.length} assigned leads · ${callCount} calls logged</div></div><span class="target-count">${owned.filter((lead) => lead.status === "Interested").length}<small style="font:400 9px 'DM Sans';color:#9aa4b6"> interested</small></span></div></div>`;
    }).join("")}</section></div>`;
}

function inputField(label, name, value = "", type = "text", options = {}) {
  const required = options.required === false ? "" : "required";
  const full = options.full ? " full" : "";
  let control;
  if (options.choices) control = `<select name="${esc(name)}" ${required}>${options.choices.map((choice) => `<option value="${esc(choice.value)}" ${String(value) === String(choice.value) ? "selected" : ""}>${esc(choice.label)}</option>`).join("")}</select>`;
  else if (options.textarea) control = `<textarea name="${esc(name)}" placeholder="${esc(options.placeholder || "")}" ${required}>${esc(value)}</textarea>`;
  else control = `<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(options.placeholder || "")}" ${required} ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.step ? `step="${options.step}"` : ""}>`;
  return `<div class="field${full}"><label>${esc(label)}</label>${control}${options.help ? `<span class="form-help">${esc(options.help)}</span>` : ""}</div>`;
}

function selectChoices(rows, labelFor, placeholder = "Choose…", valueFor = (row) => row.id) {
  return [{ value: "", label: placeholder }, ...rows.map((row) => ({ value: valueFor(row), label: labelFor(row) }))];
}

function openModal(title, formKey, fields, submitLabel = "Save changes", extras = "") {
  const error = document.querySelector(".modal-backdrop");
  if (error) error.remove();
  app.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></header><form class="modal-form" data-form="${esc(formKey)}"><div class="form-grid">${fields.join("")}${extras}</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${esc(submitLabel)}</button></div></form></section></div>`);
  const first = document.querySelector(".modal input,.modal select,.modal textarea");
  first?.focus();
}

function openLead(lead = {}) {
  const employees = state.data.employees || [];
  const fields = [
    inputField("Customer name", "name", lead.name || ""),
    inputField("Phone number", "phone", lead.phone || "", "tel"),
    inputField("Email address", "email", lead.email || "", "email", { required: false }),
    inputField("City", "city", lead.city || "", "text", { required: false }),
    inputField("Loan type", "loanType", lead.loanType || "Personal loan", "text", { choices: ["Personal loan", "Home loan", "Business loan", "Auto loan"].map((v) => ({ value: v, label: v })) }),
    inputField("Requested amount ($)", "amount", lead.amount ?? "", "number", { min: "0", step: "1000" }),
    inputField("Lead source", "source", lead.source || "Website", "text", { choices: ["Website", "Referral", "Campaign", "Walk-in", "Other"].map((v) => ({ value: v, label: v })) }),
    inputField("Status", "status", lead.status || "New", "text", { choices: ["New", "Interested", "Follow-up", "Documents", "Not interested"].map((v) => ({ value: v, label: v })) }),
    inputField("Priority", "priority", lead.priority || "Medium", "text", { choices: ["High", "Medium", "Low"].map((v) => ({ value: v, label: v })) }),
    ...(state.user.role === "admin" ? [inputField("Assigned advisor", "assigneeId", lead.assigneeId || "", "text", { choices: selectChoices(employees, (employee) => employee.name, "Unassigned") })] : []),
    inputField("Last contact", "lastContact", lead.lastContact || "Not contacted", "text", { required: false })
  ];
  openModal(lead.id ? "Edit customer lead" : "Add a new lead", "lead", fields, lead.id ? "Save lead" : "Create lead");
  const form = document.querySelector('[data-form="lead"]');
  form.dataset.id = lead.id || "";
}

function openCall(lead = findLead((state.data.leads || [])[0]?.id)) {
  if (!lead) return toast("Add or assign a lead before logging a call.", true);
  const fields = [
    inputField("Customer", "leadName", lead.name, "text", { required: false, help: `Calling ${lead.phone}` }),
    inputField("Call outcome", "outcome", lead.status === "New" ? "Interested" : "Callback requested", "text", { choices: ["Interested", "Not interested", "Callback requested", "No answer", "Busy", "Wrong number", "Documents promised"].map((v) => ({ value: v, label: v })) }),
    inputField("Call duration (minutes)", "duration", 5, "number", { min: "0", step: "1" }),
    inputField("Call notes", "remarks", "", "text", { textarea: true, full: true, placeholder: "What did you discuss? Any next steps?" }),
    inputField("Schedule a follow-up", "followupAt", "", "datetime-local", { required: false, full: true })
  ];
  openModal("Log customer call", "call", fields, "Save call");
  document.querySelector('[data-form="call"]').dataset.leadId = lead.id;
}

function openFollowup(followup = {}) {
  const leads = state.data.leads || [];
  const employees = state.data.employees || [];
  const fields = [
    inputField("Customer", "leadId", followup.leadId || "", "text", { choices: selectChoices(leads, (lead) => `${lead.name} · ${lead.phone}`) }),
    inputField("Assigned advisor", "employeeId", followup.employeeId || (state.user.role === "staff" ? state.user.id : ""), "text", { choices: selectChoices(employees, (employee) => employee.name, "Choose advisor") }),
    inputField("Due date and time", "dueAt", followup.dueAt ? new Date(new Date(followup.dueAt).getTime() - new Date(followup.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : new Date(Date.now() + 86400000).toISOString().slice(0, 16), "datetime-local"),
    inputField("Reminder note", "note", followup.note || "", "text", { textarea: true, full: true, placeholder: "What should you discuss next time?" })
  ];
  openModal(followup.id ? "Edit follow-up" : "Schedule a follow-up", "followup", fields, "Save follow-up");
}

function openDistribution() {
  const activeTeam = (state.data.employees || []).filter((employee) => employee.active);
  const choices = activeTeam.map((employee) => `<option value="${esc(employee.id)}" selected>${esc(employee.name)} · target ${Number(employee.target || 100)}</option>`).join("");
  openModal("Distribute unassigned leads", "distribution", [
    inputField("Maximum leads to assign", "limit", 100, "number", { min: "1", max: "5000", help: "Team daily targets are enforced automatically." }),
    `<div class="field full"><label>Active advisors (all selected by default)</label><select name="staffIds" multiple size="5">${choices}</select></div>`
  ], "Distribute leads");
}

function openReassignment() {
  const activeTeam = (state.data.employees || []).filter((employee) => employee.active);
  if (!state.selectedLeadIds.size) return toast("Select at least one lead first.", true);
  openModal(`Reassign ${state.selectedLeadIds.size} selected leads`, "reassign", [
    inputField("Assign to active advisor", "staffId", "", "text", { choices: selectChoices(activeTeam, (employee) => `${employee.name} · target ${employee.target}`) })
  ], "Reassign leads");
}

function openApplication(application = {}) {
  const leads = state.data.leads || [];
  const banks = state.data.banks || [];
  const fields = application.id && state.user.role === "staff"
    ? [inputField("Application remarks", "remarks", application.remarks || "", "text", { textarea: true, full: true })]
    : application.id
      ? [
        inputField("New stage", "status", application.status, "text", { choices: [{ value: application.status, label: application.status }, ...(application.availableTransitions || []).map((value) => ({ value, label: value }))] }),
        inputField("Disbursed amount ($)", "disbursedAmount", application.disbursedAmount || "", "number", { min: "0", step: "1000", required: false }),
        inputField("Disbursed on", "disbursedOn", application.disbursedOn || "", "date", { required: false }),
        inputField("Remarks / closing note", "remarks", application.remarks || "", "text", { textarea: true, full: true, required: false })
      ]
      : [
        inputField("Customer lead", "leadId", "", "text", { choices: selectChoices(leads, (lead) => `${lead.name} · ${lead.loanType}`) }),
        inputField("Bank", "bankId", "", "text", { choices: selectChoices(banks, (bank) => bank.name) }),
        inputField("Loan scheme", "schemeId", "", "text", { required: false, choices: selectChoices(state.data.schemes || [], (scheme) => scheme.name, "No scheme selected") }),
        inputField("Loan amount ($)", "amount", "", "number", { min: "0", step: "1000" })
      ];
  openModal(application.id ? state.user.role === "admin" ? "Update application stage" : "Update application remarks" : "Create loan application", "application", fields, application.id ? "Save update" : "Create application");
  document.querySelector('[data-form="application"]').dataset.id = application.id || "";
}

function showApplicationHistory(application = {}) {
  const events = application.events || [];
  const content = events.length ? events.map((event) => {
    const employee = findEmployee(event.byUser);
    const by = event.byUser === state.user.id ? state.user.name : employee?.name || "Northstar team";
    return `<div class="target-card"><div class="target-head"><span class="stat-icon tint-blue">↗</span><div><div class="target-name">${esc(event.stage.replaceAll("_", " "))}</div><div class="target-role">${esc(new Date(event.at).toLocaleString())} · ${esc(by)}</div></div></div>${event.note ? `<div class="form-help" style="margin-top:8px">${esc(event.note)}</div>` : ""}</div>`;
  }).join("") : `<div class="empty-state"><strong>No stage changes recorded</strong>Application history will appear here.</div>`;
  app.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h2>Application history · #${esc(application.id.slice(-4).toUpperCase())}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></header><div class="modal-form">${badge(application.status)}<div style="margin-top:14px">${content}</div><div class="form-actions"><button class="btn" data-action="close-modal">Close</button></div></div></section></div>`);
}

function openDocument(documentRecord = {}) {
  const leads = state.data.leads || [];
  const fields = [
    inputField("Customer", "leadId", documentRecord.leadId || "", "text", { choices: selectChoices(leads, (lead) => `${lead.name} · ${lead.loanType}`) }),
    inputField("Document name", "name", documentRecord.name || "", "text"),
    inputField("Document type", "type", documentRecord.type || "Identity", "text", { choices: ["Identity", "Income", "Address", "Business", "Other"].map((v) => ({ value: v, label: v })) }),
    inputField("Choose PDF, JPG, or PNG (max 5 MB)", "file", "", "file", { required: !documentRecord.id, full: true, help: "The file is stored privately and only visible to the assigned advisor and admins." }),
    ...(documentRecord.id && state.user.role === "admin" ? [
      inputField("Review status", "status", documentRecord.status || "Pending review", "text", { choices: ["Pending review", "Verified", "Rejected"].map((v) => ({ value: v, label: v })) }),
      inputField("Rejection reason", "rejectReason", documentRecord.rejectReason || "", "text", { required: false, textarea: true, full: true })
    ] : [])
  ];
  openModal(documentRecord.id ? "Edit document record" : "Upload a document", "document", fields, documentRecord.id ? "Save document" : "Upload document");
  document.querySelector('[data-form="document"]').dataset.id = documentRecord.id || "";
}

function openEmployee(employee = {}) {
  const fields = [
    inputField("Full name", "name", employee.name || ""),
    inputField("Work email", "email", employee.email || "", "email"),
    inputField("Phone number", "phone", employee.phone || "", "tel"),
    inputField("Job title", "role", employee.role || "Loan Advisor"),
    inputField("Daily call target", "target", employee.target || 100, "number", { min: "1" }),
    inputField("Team status", "status", employee.status || "Active", "text", { choices: ["Active", "On leave", "Inactive"].map((v) => ({ value: v, label: v })) }),
    ...(!employee.id ? [inputField("Temporary password", "password", "welcome123", "text", { help: "The staff member can sign in with this password." })] : [])
  ];
  openModal(employee.id ? "Edit team member" : "Add a team member", "employee", fields, employee.id ? "Save team member" : "Add team member");
  document.querySelector('[data-form="employee"]').dataset.id = employee.id || "";
}

function openBank(bank = {}) {
  const fields = [
    inputField("Bank name", "name", bank.name || ""),
    inputField("Short name", "shortName", bank.shortName || ""),
    inputField("Partnership contact", "contact", bank.contact || "", "text", { required: false }),
    inputField("Phone number", "phone", bank.phone || "", "tel", { required: false }),
    inputField("Status", "status", bank.status || "Active", "text", { choices: ["Active", "Inactive"].map((v) => ({ value: v, label: v })) })
  ];
  openModal(bank.id ? "Edit bank partner" : "Add bank partner", "bank", fields, bank.id ? "Save bank" : "Add bank");
  document.querySelector('[data-form="bank"]').dataset.id = bank.id || "";
}

function openScheme(scheme = {}) {
  const fields = [
    inputField("Scheme name", "name", scheme.name || ""),
    inputField("Partner bank", "bankId", scheme.bankId || "", "text", { choices: selectChoices(state.data.banks || [], (bank) => bank.name) }),
    inputField("Interest rate (%)", "rate", scheme.rate || "", "number", { min: "0", step: ".1" }),
    inputField("Maximum loan amount ($)", "maxAmount", scheme.maxAmount || "", "number", { min: "0", step: "1000" }),
    inputField("Repayment tenure", "tenure", scheme.tenure || "", "text", { placeholder: "e.g. 12–60 months" })
  ];
  openModal("Add a loan scheme", "scheme", fields, "Save scheme");
}

function toast(message, error = false) {
  const region = document.getElementById("toast-region");
  const item = document.createElement("div");
  item.className = `toast${error ? " error" : ""}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 3500);
}

function showImportSummary(result) {
  const invalidRows = result.invalid.map((item) => `<div class="person-detail">Row ${item.row}: ${esc(item.reason)}</div>`).join("");
  app.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h2>CSV import complete</h2><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></header><div class="modal-form"><div class="report-grid"><div class="report-card"><div class="report-label">Imported</div><div class="report-number">${result.imported}</div></div><div class="report-card"><div class="report-label">Duplicates skipped</div><div class="report-number">${result.duplicates}</div></div><div class="report-card"><div class="report-label">Invalid rows</div><div class="report-number">${result.invalid.length}</div></div></div>${invalidRows || `<p class="form-help">All valid rows were imported.</p>`}<div class="form-actions"><button class="btn btn-primary" data-action="close-modal">Done</button></div></div></section></div>`);
}

async function refresh() {
  await loadData();
  renderShell();
}

async function saveRecord(table, id, values) {
  const url = `/api/${table}${id ? `/${encodeURIComponent(id)}` : ""}`;
  await api(url, { method: id ? "PATCH" : "POST", body: JSON.stringify(values) });
  await refresh();
}

function downloadCsv(filename, rows) {
  if (!rows.length) return toast("There is no data to export yet.", true);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const content = [columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV needs a header row and at least one lead.");
  const parseLine = (line) => {
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
      else value += char;
    }
    cells.push(value.trim());
    if (quoted) throw new Error("A CSV value has an unclosed quote.");
    return cells;
  };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return lines.slice(1).map((line, index) => {
    const values = parseLine(line);
    const item = Object.fromEntries(headers.map((header, i) => [header, values[i] || ""]));
    if (!item.name || !item.phone) throw new Error(`Row ${index + 2} needs at least a name and phone number.`);
    return {
      name: item.name, phone: item.phone, email: item.email, city: item.city,
      loanType: item.loantype || item.loan || "Personal loan",
      amount: Number(String(item.amount || "0").replace(/[$,]/g, "")) || 0,
      status: item.status || "New", source: item.source || "CSV import",
      priority: item.priority || "Medium", assigneeId: null,
      lastContact: "Not contacted", createdAt: new Date().toISOString().slice(0, 10)
    };
  });
}

async function handlePage(page) {
  if (!pageMeta[page] || !navigation.find((item) => item.id === page && item.roles.includes(state.user.role))) return;
  state.moreOpen = false;
  state.page = page;
  state.leadPage = 1;
  state.search = "";
  if (page === "leads") await loadLeadPage();
  renderShell();
}

document.addEventListener("click", async (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) { handlePage(pageButton.dataset.page).catch((error) => toast(error.message, true)); return; }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "backdrop-close" && event.target !== button) return;
  if (action === "close-modal" || action === "backdrop-close") { document.querySelector(".modal-backdrop")?.remove(); return; }
  if (action === "close-more") {
    if (event.target === button) { state.moreOpen = false; renderShell(); }
    return;
  }
  if (action === "more") { state.moreOpen = !state.moreOpen; renderShell(); return; }
  try {
    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      showLogin();
    } else if (action === "fill-demo") {
      document.querySelector("#login-email").value = button.dataset.email;
      document.querySelector("#login-password").value = button.dataset.password;
    } else if (action === "new-lead") openLead();
    else if (action === "edit-lead") openLead(findLead(button.dataset.id));
    else if (action === "log-call") openCall(findLead(button.dataset.id));
    else if (action === "new-call") openCall();
    else if (action === "new-followup") openFollowup();
    else if (action === "distribute") openDistribution();
    else if (action === "reassign-selected") openReassignment();
    else if (action === "new-application") openApplication();
    else if (action === "upload-document") openDocument();
    else if (action === "upload-lead-document") openDocument({ leadId: button.dataset.leadId });
    else if (action === "edit-document") openDocument((state.data.documents || []).find((item) => item.id === button.dataset.id));
    else if (action === "new-employee") openEmployee();
    else if (action === "edit-employee") openEmployee(findEmployee(button.dataset.id));
    else if (action === "new-bank") openBank();
    else if (action === "edit-bank") openBank(findBank(button.dataset.id));
    else if (action === "new-scheme") openScheme();
    else if (action === "edit-application") openApplication((state.data.applications || []).find((item) => item.id === button.dataset.id));
    else if (action === "change-password") openModal("Change your password", "password", [
      inputField("Current password", "currentPassword", "", "password"),
      inputField("New password", "newPassword", "", "password", { help: "Use at least 8 characters." }),
      inputField("Confirm new password", "confirmPassword", "", "password")
    ], "Update password");
    else if (action === "reset-password") {
      if (!confirm("Reset this team member’s password? The temporary password will be shown once.")) return;
      const result = await api(`/api/employees/${encodeURIComponent(button.dataset.id)}/reset-password`, { method: "POST", body: JSON.stringify({}) });
      toast(`Temporary password: ${result.temporaryPassword}`);
    }
    else if (action === "verify-document" || action === "reject-document") {
      const status = action === "verify-document" ? "Verified" : "Rejected";
      const rejectReason = action === "reject-document" ? prompt("Why is this document being rejected?") : "";
      if (action === "reject-document" && !rejectReason?.trim()) return;
      await saveRecord("documents", button.dataset.id, { status, ...(rejectReason ? { rejectReason: rejectReason.trim() } : {}) });
      toast(`Document marked ${status.toLowerCase()}.`);
    } else if (action === "complete-followup") {
      await saveRecord("followups", button.dataset.id, { status: "Completed" });
      toast("Follow-up marked complete.");
    } else if (action === "lead-page") {
      state.leadPage = Math.max(1, state.leadPage + Number(button.dataset.value));
      await loadLeadPage();
      renderShell();
    } else if (action === "export") downloadCsv("northstar-leads.csv", state.data.leads || []);
    else if (action === "export-employees") downloadCsv("northstar-team.csv", state.data.employees || []);
    else if (action === "import-csv") document.getElementById("csv-file-input").click();
    else if (action === "notifications") {
      const overdue = (state.data.followups || []).filter((item) => item.status === "Overdue").length;
      toast(overdue ? `You have ${overdue} overdue follow-up${overdue === 1 ? "" : "s"}.` : "You’re all caught up — no overdue follow-ups.");
    } else if (action === "profile") toast(`${state.user.name} · ${state.user.email}`);
  } catch (error) { toast(error.message, true); }
});

document.addEventListener("change", async (event) => {
  const target = event.target;
  try {
    if (target.id === "call-period") {
      state.chartPeriod = target.value;
      document.getElementById("page-content").innerHTML = renderPage();
    } else if (target.id === "lead-status-filter") {
      state.filters.leads = target.value;
      state.leadPage = 1;
      await loadLeadPage();
      document.getElementById("page-content").innerHTML = renderPage();
    } else if (target.classList.contains("lead-select")) {
      if (target.checked) state.selectedLeadIds.add(target.dataset.id);
      else state.selectedLeadIds.delete(target.dataset.id);
      document.getElementById("page-content").innerHTML = renderPage();
    } else if (target.classList.contains("lead-select-all")) {
      for (const lead of state.leadPageRows) {
        if (target.checked) state.selectedLeadIds.add(lead.id);
        else state.selectedLeadIds.delete(lead.id);
      }
      document.getElementById("page-content").innerHTML = renderPage();
    }
    else if (target.id === "application-status-filter") {
      const status = target.value;
      const rows = [...document.querySelectorAll(".application-status")];
      rows.forEach((row) => { row.closest("tr").hidden = status !== "All statuses" && row.value !== status; });
    } else if (target.classList.contains("assign-select")) {
      await saveRecord("leads", target.dataset.id, { assigneeId: target.value || null });
      toast("Lead assignment updated.");
    } else if (target.classList.contains("application-status")) {
      await saveRecord("applications", target.dataset.id, { status: target.value });
      toast("Application status updated.");
    } else if (target.id === "csv-file-input") {
      const file = target.files?.[0];
      if (!file) return;
      if (file.size > 2_000_000) throw new Error("CSV must be smaller than 2 MB.");
      const result = await api("/api/leads/import", { method: "POST", body: JSON.stringify({ csv: await file.text() }) });
      await refresh();
      showImportSummary(result);
      target.value = "";
    } else if (target.name === "file") {
      const filename = target.files?.[0]?.name;
      if (filename) document.querySelector('[data-form="document"] [name="fileName"]').value = filename;
    }
  } catch (error) { toast(error.message, true); }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "global-search") return;
  state.search = event.target.value;
  if (state.page === "dashboard") return;
  if (state.page === "leads") {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      try {
        state.leadPage = 1;
        await loadLeadPage();
        const content = document.getElementById("page-content");
        if (content) content.innerHTML = renderPage();
      } catch (error) { toast(error.message, true); }
    }, 250);
    return;
  }
  const cursor = event.target.selectionStart;
  const pageContent = document.getElementById("page-content");
  if (pageContent) pageContent.innerHTML = renderPage();
  const replacement = document.getElementById("global-search");
  if (replacement) { replacement.value = state.search; replacement.focus(); replacement.setSelectionRange(cursor, cursor); }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  const formType = form.dataset.form;
  try {
    if (form.dataset.form === "login") {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(values) });
      state.user = result.user;
      state.page = "dashboard";
      await refresh();
      return;
    }
    if (formType === "password") {
      if (values.newPassword !== values.confirmPassword) throw new Error("The new passwords do not match.");
      delete values.confirmPassword;
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify(values) });
      document.querySelector(".modal-backdrop")?.remove();
      toast("Your password has been updated.");
      return;
    }
    if (formType === "distribution") {
      const distribution = new FormData(form);
      const staffIds = distribution.getAll("staffIds");
      const result = await api("/api/leads/distribute", { method: "POST", body: JSON.stringify({ limit: Number(values.limit), mode: "equal", staffIds }) });
      await refresh();
      document.querySelector(".modal-backdrop")?.remove();
      toast(`${result.assigned} leads distributed: ${result.counts.filter((item) => item.count).map((item) => `${item.name} ${item.count}`).join(", ") || "no assignments"}.`);
      return;
    }
    if (formType === "reassign") {
      const result = await api("/api/leads/reassign", { method: "POST", body: JSON.stringify({ leadIds: [...state.selectedLeadIds], staffId: values.staffId }) });
      state.selectedLeadIds.clear();
      await refresh();
      document.querySelector(".modal-backdrop")?.remove();
      toast(`${result.reassigned} leads reassigned to ${result.name}.`);
      return;
    }
    if (values.amount !== undefined) values.amount = Number(values.amount) || 0;
    if (values.target !== undefined) values.target = Number(values.target) || 100;
    if (values.rate !== undefined) values.rate = Number(values.rate) || 0;
    if (values.maxAmount !== undefined) values.maxAmount = Number(values.maxAmount) || 0;
    if (values.duration !== undefined) values.duration = Number(values.duration) || 0;
    const id = form.dataset.id || "";
    if (formType === "lead") {
      if (state.user.role === "staff" && !id) values.assigneeId = state.user.id;
      await saveRecord("leads", id, values);
      toast(id ? "Lead updated." : "New lead added.");
    } else if (formType === "call") {
      const { leadName, ...call } = values;
      call.leadId = form.dataset.leadId;
      call.employeeId = state.user.id;
      await api("/api/calls", { method: "POST", body: JSON.stringify(call) });
      await refresh();
      toast("Call logged and lead activity updated.");
    } else if (formType === "followup") {
      if (state.user.role === "staff") values.employeeId = state.user.id;
      values.dueAt = new Date(values.dueAt).toISOString();
      values.status = "Scheduled";
      await saveRecord("followups", "", values);
      toast("Follow-up scheduled.");
    } else if (formType === "application") {
      await saveRecord("applications", id, values);
      toast(id ? "Application updated." : "Application created.");
    } else if (formType === "document") {
      if (id) {
        delete values.file;
        await saveRecord("documents", id, values);
        toast("Document record updated.");
      } else {
        const file = new FormData(form).get("file");
        if (!(file instanceof File) || !file.size) throw new Error("Choose a PDF, JPG, or PNG document to upload.");
        if (file.size > 5 * 1024 * 1024) throw new Error("Document must be 5 MB or smaller.");
        const upload = new FormData();
        for (const [key, value] of Object.entries(values)) if (key !== "file") upload.append(key, value);
        upload.append("file", file);
        const response = await fetch("/api/documents", { method: "POST", credentials: "same-origin", body: upload });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
        await refresh();
        toast("Document uploaded securely.");
      }
    } else if (formType === "employee") {
      values.joined = id ? findEmployee(id).joined : new Date().toISOString().slice(0, 10);
      await saveRecord("employees", id, values);
      toast(id ? "Team member updated." : "Team member added. Temporary password: welcome123 unless changed.");
    } else if (formType === "bank") {
      await saveRecord("banks", id, values);
      toast(id ? "Bank updated." : "Bank partner added.");
    } else if (formType === "scheme") {
      values.status = "Active";
      await saveRecord("schemes", "", values);
      toast("Loan scheme added.");
    }
    document.querySelector(".modal-backdrop")?.remove();
  } catch (error) {
    if (formType === "login") showLogin(error.message);
    else toast(error.message, true);
  }
});

async function boot() {
  if (mobileRoute) document.body.classList.add("mobile");
  try {
    const result = await api("/api/auth/me");
    state.user = result.user;
    await refresh();
  } catch {
    showLogin();
  }
  const input = document.createElement("input");
  input.id = "csv-file-input";
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.hidden = true;
  document.body.append(input);
}

boot();
