const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

let server;
let baseUrl;
let dataDirectory;

async function unusedPort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(pathname, { method = "GET", body, cookie, forwardedProto } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(forwardedProto ? { "X-Forwarded-Proto": forwardedProto } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, body: await response.json(), cookie: setCookie?.split(";")[0], setCookie };
}

async function login(email, password, forwardedProto) {
  const result = await request("/api/auth/login", { method: "POST", body: { email, password }, forwardedProto });
  return { ...result, session: result.cookie };
}

async function uploadDocument(cookie, { leadId, name = "Government ID", fileName = "identity.pdf", content = Buffer.from("%PDF-1.4\nsample"), contentType = "application/pdf" }) {
  const form = new FormData();
  form.append("leadId", leadId);
  form.append("name", name);
  form.append("type", "Identity");
  form.append("file", new Blob([content], { type: contentType }), fileName);
  const response = await fetch(`${baseUrl}/api/documents`, { method: "POST", headers: { Cookie: cookie }, body: form });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "northstar-crm-test-"));
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_PATH: path.join(dataDirectory, "test.db"), UPLOAD_DIR: path.join(dataDirectory, "uploads") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`CRM server exited before starting:\n${output}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`CRM server did not start in time:\n${output}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
  if (dataDirectory && fs.existsSync(dataDirectory)) fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test("admin and staff can perform their assigned CRM workflows", async () => {
  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /type="module" src="\/app\.js"/);
  const policy = home.headers.get("content-security-policy");
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /style-src 'self'[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(policy, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  for (const [asset, type] of [["/app.js", "text/javascript"], ["/modules/api.js", "text/javascript"], ["/modules/formatters.js", "text/javascript"], ["/styles.css", "text/css"]]) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should be included and served`);
    assert.match(response.headers.get("content-type"), new RegExp(type));
  }
  assert.equal((await fetch(`${baseUrl}/mobile`)).status, 200);

  const authStart = performance.now();
  const unauthenticated = await request("/api/auth/me");
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error, "Not signed in");
  assert.ok(performance.now() - authStart < 1500, "unauthenticated auth check should return promptly");

  const denied = await login("admin@northstar.demo", "incorrect");
  assert.equal(denied.status, 401);

  const localProductionLogin = await login("admin@northstar.demo", "admin123");
  assert.equal(localProductionLogin.status, 200);
  assert.doesNotMatch(localProductionLogin.setCookie, /;\s*Secure/i);
  const admin = await login("admin@northstar.demo", "admin123", "https, http");
  assert.equal(admin.status, 200);
  assert.equal(admin.body.user.role, "admin");
  assert.match(admin.setCookie, /HttpOnly/);
  assert.match(admin.setCookie, /;\s*Secure/i);
  const leads = await request("/api/leads", { cookie: admin.session });
  assert.equal(leads.body.length, 24);
  const searchPage = await fetch(`${baseUrl}/api/leads?page=1&pageSize=4&search=Sophie`, { headers: { Cookie: admin.session } });
  assert.equal(searchPage.status, 200);
  assert.equal(searchPage.headers.get("x-total-count"), "1");
  assert.equal((await searchPage.json()).length, 1);
  assert.equal((await fetch(`${baseUrl}/api/leads?page=0&pageSize=4`, { headers: { Cookie: admin.session } })).status, 400);
  const importResult = await request("/api/leads/import", { method: "POST", cookie: admin.session, body: { csv: "name,phone,loan_type,amount\nCSV Import One,(415) 555-1188,Personal loan,12000\nCSV Import Duplicate,+1 415 555 1188,Home loan,20000\nCSV Missing Phone,,Auto loan,9000" } });
  assert.equal(importResult.body.imported, 1);
  assert.equal(importResult.body.duplicates, 1);
  assert.equal(importResult.body.invalid.length, 1);
  const leadsAfterImport = await request("/api/leads", { cookie: admin.session });
  const allCalls = await request("/api/calls", { cookie: admin.session });
  const dashboardBeforeCall = await request("/api/dashboard", { cookie: admin.session });
  const callsToday = allCalls.body.filter((item) => new Date(item.createdAt).toDateString() === new Date().toDateString()).length;
  assert.equal(dashboardBeforeCall.status, 200);
  assert.equal(dashboardBeforeCall.body.callsToday, callsToday);
  assert.equal(dashboardBeforeCall.body.pipelineValue, leadsAfterImport.body.reduce((sum, lead) => sum + Number(lead.amount || 0), 0));
  assert.equal(dashboardBeforeCall.body.newLeadsThisWeek, leadsAfterImport.body.filter((lead) => Date.now() - new Date(lead.createdAt).getTime() < 7 * 86400000).length);
  assert.equal(dashboardBeforeCall.body.approved, (await request("/api/applications", { cookie: admin.session })).body.filter((item) => ["Approved", "Disbursed"].includes(item.status)).length);
  assert.equal(dashboardBeforeCall.body.callVolume.length, 7);
  assert.equal(dashboardBeforeCall.body.callVolume.reduce((sum, item) => sum + item.calls, 0), allCalls.body.filter((item) => Date.now() - new Date(item.createdAt).getTime() < 7 * 86400000).length);
  assert.ok(dashboardBeforeCall.body.employeeMetrics.every((metric) => metric.callsToday === allCalls.body.filter((item) => item.employeeId === metric.id && new Date(item.createdAt).toDateString() === new Date().toDateString()).length));

  const staff = await login("staff@northstar.demo", "staff123");
  assert.equal(staff.body.user.role, "staff");
  const staffDirectory = await request("/api/employees", { cookie: staff.session });
  assert.deepEqual(Object.keys(staffDirectory.body[0]).sort(), ["id", "name", "role", "status"]);
  const assignedLeads = await request("/api/leads", { cookie: staff.session });
  assert.ok(assignedLeads.body.length > 0);
  assert.ok(assignedLeads.body.every((lead) => lead.assigneeId === staff.body.user.id));
  const staffBanks = await request("/api/banks", { cookie: staff.session });
  assert.equal(staffBanks.status, 200);
  assert.ok(staffBanks.body.every((bank) => bank.status === "Active"));
  assert.equal((await request("/api/banks", { method: "POST", cookie: staff.session, body: { name: "Unauthorized Bank", status: "Active" } })).status, 403);
  const staffCreatedLead = await request("/api/leads", { method: "POST", cookie: staff.session, body: { id: "spoofed-id", name: "Staff-created lead", phone: "555-0101", loanType: "Personal loan", status: "Converted", assigneeId: "usr-staff-2", role: "admin" } });
  assert.equal(staffCreatedLead.body.assigneeId, staff.body.user.id);
  assert.equal(staffCreatedLead.body.status, "New");
  assert.notEqual(staffCreatedLead.body.id, "spoofed-id");

  const ownLead = assignedLeads.body[0];
  const call = await request("/api/calls", { method: "POST", cookie: staff.session, body: { leadId: ownLead.id, employeeId: "usr-staff-2", outcome: "Callback requested", remarks: "Call test", followupAt: new Date(Date.now() + 86400000).toISOString() } });
  assert.equal(call.status, 201);
  assert.equal(call.body.employeeId, staff.body.user.id);
  assert.equal((await request("/api/calls", { cookie: staff.session })).body.some((item) => item.id === call.body.id), true);
  assert.equal((await request(`/api/leads/${ownLead.id}`, { cookie: staff.session })).body.status, "Follow-up");
  assert.ok((await request("/api/followups", { cookie: staff.session })).body.some((item) => item.note === "Call test"));
  const updatedStaffDashboard = await request("/api/dashboard", { cookie: staff.session });
  assert.equal(updatedStaffDashboard.body.callsToday, dashboardBeforeCall.body.employeeMetrics.find((metric) => metric.id === staff.body.user.id).callsToday + 1);
  assert.equal((await request("/api/dashboard", { cookie: admin.session })).body.callsToday, dashboardBeforeCall.body.callsToday + 1);
  const noAnswer = await request("/api/calls", { method: "POST", cookie: staff.session, body: { leadId: ownLead.id, outcome: "No answer", remarks: "Try tomorrow" } });
  assert.equal(noAnswer.status, 201);
  assert.equal((await request(`/api/leads/${ownLead.id}`, { cookie: staff.session })).body.status, "Follow-up");

  const overdueFollowup = await request("/api/followups", { method: "POST", cookie: staff.session, body: { leadId: ownLead.id, employeeId: staff.body.user.id, dueAt: new Date(Date.now() - 60000).toISOString(), note: "Read-time overdue test", status: "Scheduled" } });
  assert.equal(overdueFollowup.status, 201);
  const visibleFollowups = await request("/api/followups", { cookie: staff.session });
  assert.equal(visibleFollowups.body.find((item) => item.id === overdueFollowup.body.id).status, "Overdue");
  assert.equal((await request(`/api/followups/${overdueFollowup.body.id}`, { cookie: staff.session })).body.status, "Overdue");

  const unauthorizedLead = leads.body.find((lead) => lead.assigneeId !== staff.body.user.id);
  const unauthorizedCall = await request("/api/calls", { method: "POST", cookie: staff.session, body: { leadId: unauthorizedLead.id, employeeId: staff.body.user.id, outcome: "Interested" } });
  assert.equal(unauthorizedCall.status, 403);
  assert.equal((await uploadDocument(staff.session, { leadId: unauthorizedLead.id })).status, 403);
  assert.equal((await request("/api/applications", { method: "POST", cookie: staff.session, body: { leadId: unauthorizedLead.id, bankId: "bank-1", status: "Submitted" } })).status, 403);

  const createdLead = await request("/api/leads", { method: "POST", cookie: admin.session, body: { name: "Admin workflow lead", phone: "555-0102", loanType: "Home loan", status: "New", amount: 140000, assigneeId: ownLead.assigneeId } });
  assert.equal(createdLead.status, 201);
  const application = await request("/api/applications", { method: "POST", cookie: admin.session, body: { leadId: createdLead.body.id, bankId: "bank-1", schemeId: "scheme-1", amount: 140000, status: "Submitted" } });
  assert.equal(application.status, 201);
  assert.equal((await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: staff.session, body: { status: "Approved" } })).status, 403);
  assert.equal((await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: staff.session, body: { stage: "Disbursed" } })).status, 403);
  assert.equal(createdLead.body.assigneeId, staff.body.user.id);
  const staffRemarks = await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: staff.session, body: { remarks: "Customer called back" } });
  assert.equal(staffRemarks.status, 200, staffRemarks.body.error);
  assert.equal((await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Closed", remarks: "Too early" } })).status, 400);
  const reviewingApplication = await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Under review" } });
  assert.equal(reviewingApplication.body.status, "Under review");
  assert.equal((await request(`/api/applications/${application.body.id}`, { cookie: admin.session })).body.events.length, 2);
  assert.equal((await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Disbursed" } })).status, 400);
  const updatedApplication = await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Approved" } });
  assert.equal(updatedApplication.body.status, "Approved");
  const disbursedApplication = await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Disbursed", disbursedAmount: 138000, disbursedOn: new Date().toISOString().slice(0, 10), remarks: "Funds sent" } });
  assert.equal(disbursedApplication.body.status, "Disbursed");
  assert.equal((await request(`/api/leads/${createdLead.body.id}`, { cookie: admin.session })).body.status, "Converted");
  assert.equal((await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Closed" } })).status, 400);
  const closedApplication = await request(`/api/applications/${application.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Closed", remarks: "File archived after disbursement." } });
  assert.equal(closedApplication.body.status, "Closed");
  assert.equal(closedApplication.body.events.at(-1).stage, "closed");
  const document = await uploadDocument(admin.session, { leadId: createdLead.body.id });
  assert.equal(document.status, 201);
  assert.equal(document.body.hasFile, true);
  assert.equal(document.body.fileName, "identity.pdf");
  assert.equal((await request(`/api/documents/${document.body.id}`, { method: "PATCH", cookie: staff.session, body: { status: "Verified" } })).status, 403);
  assert.equal((await request(`/api/documents/${document.body.id}`, { method: "PATCH", cookie: staff.session, body: { status: "Rejected" } })).status, 403);
  assert.equal((await request(`/api/documents/${document.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Verified" } })).body.status, "Verified");
  const download = await fetch(`${baseUrl}/api/documents/${document.body.id}/file`, { headers: { Cookie: staff.session } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.match(await download.text(), /^%PDF-1\.4/);
  const otherStaff = await login("ethan@northstar.demo", "staff123");
  assert.equal((await fetch(`${baseUrl}/api/documents/${document.body.id}/file`, { headers: { Cookie: otherStaff.session } })).status, 403);
  assert.equal((await uploadDocument(staff.session, { leadId: createdLead.body.id, fileName: "identity.txt" })).status, 400);
  assert.equal((await uploadDocument(staff.session, { leadId: createdLead.body.id, content: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024)]) })).status, 413);
  const staffUpload = await uploadDocument(staff.session, { leadId: ownLead.id, fileName: "staff-id.pdf" });
  assert.equal(staffUpload.status, 201);
  assert.equal(staffUpload.body.status, "Pending review");
  assert.equal((await request(`/api/documents/${staffUpload.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Verified" } })).body.status, "Verified");
  const rejected = await request(`/api/documents/${staffUpload.body.id}`, { method: "PATCH", cookie: admin.session, body: { status: "Rejected", rejectReason: "Please upload an unexpired ID." } });
  assert.equal(rejected.body.status, "Rejected");
  assert.equal((await request(`/api/documents/${staffUpload.body.id}`, { cookie: staff.session })).body.rejectReason, "Please upload an unexpired ID.");

  const employee = await request("/api/employees", { method: "POST", cookie: admin.session, body: { name: "Test Advisor", email: "test.advisor@example.demo", role: "Loan Advisor", phone: "555-0103", target: 1, status: "Active", password: "welcome123" } });
  assert.equal(employee.status, 201);
  const newStaffLogin = await login("test.advisor@example.demo", "welcome123");
  assert.equal(newStaffLogin.body.user.id, employee.body.id);
  assert.equal((await request("/api/employees/usr-admin", { method: "DELETE", cookie: admin.session })).status, 403);
  assert.equal((await request("/api/employees/usr-admin", { method: "PATCH", cookie: admin.session, body: { status: "Inactive" } })).status, 403);

  assert.equal((await request(`/api/employees/${employee.body.id}/reset-password`, { method: "POST", cookie: admin.session, body: { password: "new-temporary-password" } })).status, 200);
  assert.equal((await login("test.advisor@example.demo", "welcome123")).status, 401);
  const resetLogin = await login("test.advisor@example.demo", "new-temporary-password");
  assert.equal(resetLogin.status, 200);
  assert.equal((await request("/api/auth/change-password", { method: "POST", cookie: resetLogin.session, body: { currentPassword: "new-temporary-password", newPassword: "changed-password" } })).status, 200);
  assert.equal((await login("test.advisor@example.demo", "changed-password")).status, 200);

  const inactiveEmployee = await request("/api/employees", { method: "POST", cookie: admin.session, body: { name: "Inactive Advisor", email: "inactive.advisor@example.demo", role: "Loan Advisor", target: 10, status: "Inactive", password: "welcome123" } });
  const distribution = await request("/api/leads/distribute", { method: "POST", cookie: admin.session, body: { staffIds: [employee.body.id, inactiveEmployee.body.id], limit: 10, mode: "equal" } });
  assert.equal(distribution.status, 200);
  assert.equal(distribution.body.assigned, 1);
  assert.equal(distribution.body.counts.some((item) => item.staffId === inactiveEmployee.body.id), false);
  const assignedByDistribution = (await request("/api/leads", { cookie: admin.session })).body.find((lead) => lead.assigneeId === employee.body.id);
  assert.ok(assignedByDistribution);
  const cappedDistribution = await request("/api/leads/distribute", { method: "POST", cookie: admin.session, body: { staffIds: [employee.body.id], limit: 10, mode: "equal" } });
  assert.equal(cappedDistribution.body.assigned, 0);
  const noAdvisorDistribution = await request("/api/leads/distribute", { method: "POST", cookie: admin.session, body: { staffIds: [], limit: 10, mode: "equal" } });
  assert.equal(noAdvisorDistribution.body.assigned, 0);
  const unassignedLead = (await request("/api/leads", { cookie: admin.session })).body.find((lead) => !lead.assigneeId);
  const rejectedReassignment = await request("/api/leads/reassign", { method: "POST", cookie: admin.session, body: { leadIds: [unassignedLead.id], staffId: employee.body.id } });
  assert.equal(rejectedReassignment.status, 409);
  assert.equal((await request(`/api/leads/${unassignedLead.id}`, { cookie: admin.session })).body.assigneeId, null);
  const reassigned = await request("/api/leads/reassign", { method: "POST", cookie: admin.session, body: { leadIds: [assignedByDistribution.id], staffId: staff.body.user.id } });
  assert.equal(reassigned.status, 200);
  assert.equal((await request(`/api/leads/${assignedByDistribution.id}`, { cookie: admin.session })).body.assigneeId, staff.body.user.id);
  assert.notEqual((await request(`/api/leads/${assignedByDistribution.id}`, { cookie: admin.session })).body.assigneeId, inactiveEmployee.body.id);

  const inactivePatch = await request("/api/employees/usr-staff-5", { method: "PATCH", cookie: admin.session, body: { status: "Inactive" } });
  assert.equal(inactivePatch.status, 200);
  assert.equal((await login("ava@northstar.demo", "staff123")).status, 401);
  assert.equal((await request("/api/employees/usr-staff-5", { method: "PATCH", cookie: admin.session, body: { status: "Active" } })).status, 200);

  assert.equal((await request("/api/leads", { method: "POST", cookie: admin.session, body: { name: "Bad amount", phone: "555-0104", loanType: "Personal loan", status: "New", amount: -1 } })).status, 400);
  assert.equal((await request("/api/leads", { method: "POST", cookie: admin.session, body: { name: "Bad phone", phone: "not a phone", loanType: "Personal loan", status: "New" } })).status, 400);

  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login("rate-limit@example.demo", "wrong-password")).status, 401);
  assert.equal((await login("rate-limit@example.demo", "wrong-password")).status, 429);

  const securityHeaders = await fetch(baseUrl);
  assert.equal(securityHeaders.headers.get("x-content-type-options"), "nosniff");
  assert.equal(securityHeaders.headers.get("x-frame-options"), "DENY");
  assert.match(securityHeaders.headers.get("content-security-policy"), /fonts\.googleapis\.com/);
});
