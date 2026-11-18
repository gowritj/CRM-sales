const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const store = require("./db");
const { allowedValues, pickFields, validateInput } = require("./server/validation");
const createLeadOperations = require("./server/lead-operations");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, "uploads"));
const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const loginAttempts = new Map();
const loginWindow = 15 * 60 * 1000;
const maxLoginFailures = 5;
const applicationTransitions = {
  Submitted: ["Documents pending", "Under review", "Rejected"],
  "Documents pending": ["Submitted", "Under review", "Rejected"],
  "Under review": ["Documents pending", "Approved", "Rejected"],
  Approved: ["Disbursed", "Rejected"],
  Rejected: ["Closed"],
  Disbursed: ["Closed"],
  Closed: []
};
const writableFields = {
  leads: ["name", "email", "phone", "city", "loanType", "amount", "status", "source", "priority", "assigneeId", "lastContact", "lastContactAt"],
  employees: ["name", "email", "role", "phone", "target", "status", "joined", "password"],
  banks: ["name", "shortName", "status", "contact", "phone"],
  schemes: ["name", "bankId", "rate", "maxAmount", "tenure", "status"],
  applications: ["leadId", "bankId", "schemeId", "amount", "status", "stage", "disbursedAmount", "disbursedOn", "remarks"],
  documents: ["leadId", "name", "type", "fileName", "status", "rejectReason"],
  calls: ["leadId", "employeeId", "outcome", "remarks", "duration", "followupAt"],
  followups: ["leadId", "employeeId", "dueAt", "note", "status", "done"]
};
const { distributeLeads, importLeads, reassignLeads } = createLeadOperations(store, validateInput);

function loginKey(req, email) {
  return `${req.socket.remoteAddress || "unknown"}:${email}`;
}

function getLoginAttemptState(key, now = Date.now()) {
  const attempts = (loginAttempts.get(key) || []).filter((at) => now - at < loginWindow);
  if (attempts.length) loginAttempts.set(key, attempts);
  else loginAttempts.delete(key);
  return attempts;
}

function secureCookieForRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https" || Boolean(req.socket.encrypted);
}

function validAssignee(id) {
  if (id === null || id === "") return true;
  const employee = store.selectAll("employees").find((item) => item.id === id);
  return Boolean(employee?.active);
}

const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
};

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 5_000_000) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readMultipart(req) {
  const contentType = String(req.headers["content-type"] || "");
  const match = contentType.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw Object.assign(new Error("Send the document as multipart form data."), { status: 400 });
  const boundary = (match[1] || match[2]).trim();
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 5 * 1024 * 1024 + 128 * 1024) throw Object.assign(new Error("Upload must be smaller than 5 MB."), { status: 413 });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const marker = Buffer.from(`--${boundary}`);
  const nextMarker = Buffer.concat([Buffer.from("\r\n"), marker]);
  const fields = {};
  let file = null;
  let cursor = body.indexOf(marker);
  if (cursor < 0) throw Object.assign(new Error("Malformed multipart request."), { status: 400 });
  while (cursor >= 0) {
    cursor += marker.length;
    if (body.subarray(cursor, cursor + 2).toString() === "--") break;
    if (body.subarray(cursor, cursor + 2).toString() !== "\r\n") throw Object.assign(new Error("Malformed multipart boundary."), { status: 400 });
    const headerStart = cursor + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) throw Object.assign(new Error("Malformed multipart headers."), { status: 400 });
    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
    if (!name) throw Object.assign(new Error("Multipart fields must have a name."), { status: 400 });
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    const contentStart = headerEnd + 4;
    const contentEnd = body.indexOf(nextMarker, contentStart);
    if (contentEnd < 0) throw Object.assign(new Error("Malformed multipart content."), { status: 400 });
    const data = body.subarray(contentStart, contentEnd);
    if (filename !== undefined) {
      if (file) throw Object.assign(new Error("Upload one document at a time."), { status: 400 });
      file = { filename, contentType: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "", data };
    } else {
      fields[name] = data.toString("utf8");
    }
    cursor = contentEnd + 2;
    if (body.subarray(cursor + marker.length, cursor + marker.length + 2).toString() === "--") break;
  }
  if (!file) throw Object.assign(new Error("Choose a PDF, JPG, or PNG document to upload."), { status: 400 });
  if (!file.data.length) throw Object.assign(new Error("The selected document is empty."), { status: 400 });
  if (file.data.length > 5 * 1024 * 1024) throw Object.assign(new Error("Document must be 5 MB or smaller."), { status: 413 });
  return { fields, file };
}

function identifyDocument(file) {
  const extension = path.extname(file.filename.replace(/\\/g, "/")).toLowerCase();
  const signatures = {
    ".pdf": { mime: "application/pdf", valid: file.data.subarray(0, 5).toString() === "%PDF-" },
    ".jpg": { mime: "image/jpeg", valid: file.data.length >= 3 && file.data[0] === 0xff && file.data[1] === 0xd8 && file.data[2] === 0xff },
    ".jpeg": { mime: "image/jpeg", valid: file.data.length >= 3 && file.data[0] === 0xff && file.data[1] === 0xd8 && file.data[2] === 0xff },
    ".png": { mime: "image/png", valid: file.data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }
  };
  const signature = signatures[extension];
  if (!signature || file.contentType !== signature.mime || !signature.valid) throw Object.assign(new Error("Only valid PDF, JPG, or PNG documents are accepted."), { status: 400 });
  return { extension: extension === ".jpeg" ? ".jpg" : extension, mime: signature.mime };
}

function requestToken(req) {
  return (req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("crm_session="))?.slice("crm_session=".length);
}

function getUser(req) {
  const session = store.getSession(requestToken(req));
  return session?.user?.active ? session.user : null;
}

function canAccess(user, row) {
  return user.role === "admin" || row.assigneeId === user.id || row.employeeId === user.id || store.selectAll("leads").some((lead) => lead.id === row.leadId && lead.assigneeId === user.id);
}

function requireUser(user, role) {
  if (!user) return { error: "Please sign in to continue", status: 401 };
  if (role === "admin" && user.role !== "admin") return { error: "Admin access is required", status: 403 };
  return null;
}

function publicUser(user) {
  const { id, name, email, role, initials, color } = user;
  return { id, name, email, role, initials, color };
}

function followupStatus(followup, now = Date.now()) {
  if (followup.done || followup.status === "Completed") return "Completed";
  return new Date(followup.dueAt).getTime() < now ? "Overdue" : "Scheduled";
}

function handleLogin(req, res, body) {
  const email = String(body.email || "").toLowerCase().trim();
  const key = loginKey(req, email);
  if (getLoginAttemptState(key).length >= maxLoginFailures) return json(res, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
  const user = store.getUserByEmail(email);
  const attempted = user && crypto.scryptSync(String(body.password || ""), user.salt, 64);
  const correct = attempted && user.active && crypto.timingSafeEqual(attempted, Buffer.from(user.password_hash, "hex"));
  if (!correct) {
    const attempts = getLoginAttemptState(key);
    attempts.push(Date.now());
    loginAttempts.set(key, attempts);
    return json(res, 401, { error: "Email or password is incorrect" });
  }
  loginAttempts.delete(key);
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  store.createSession(token, user.id, expiresAt);
  const secure = process.env.NODE_ENV === "production" && secureCookieForRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `crm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
  return json(res, 200, { user: publicUser(user) });
}

function dashboardFor(user) {
  const leads = store.selectAll("leads");
  const calls = store.selectAll("calls");
  const followups = store.selectAll("followups");
  const applications = store.selectAll("applications");
  const employees = store.selectAll("employees");
  const ownLeads = leads.filter((lead) => user.role === "admin" || lead.assigneeId === user.id);
  const ownCalls = calls.filter((call) => user.role === "admin" || call.employeeId === user.id);
  const now = new Date();
  const todayKey = store.dateOnly(now);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const callsToday = ownCalls.filter((call) => store.dateOnly(new Date(call.createdAt)) === todayKey);
  const callVolume = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - index));
    const key = store.dateOnly(date);
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      date: key,
      calls: ownCalls.filter((call) => store.dateOnly(new Date(call.createdAt)) === key).length
    };
  });
  const myFollowups = followups.filter((item) => (user.role === "admin" || item.employeeId === user.id) && followupStatus(item) !== "Completed");
  const ownApplications = applications.filter((application) => {
    const lead = leads.find((item) => item.id === application.leadId);
    return user.role === "admin" || lead?.assigneeId === user.id;
  });
  const approvedApplications = ownApplications.filter((application) => ["Approved", "Disbursed"].includes(application.status));
  const newLeadsThisWeek = ownLeads.filter((lead) => new Date(lead.createdAt).getTime() >= weekStart.getTime()).length;
  const target = user.role === "staff"
    ? Number(employees.find((employee) => employee.id === user.id)?.target || 100)
    : employees.filter((employee) => employee.active).reduce((sum, employee) => sum + Number(employee.target || 100), 0);
  const employeeMetrics = employees.map((employee) => {
    const count = calls.filter((call) => call.employeeId === employee.id && store.dateOnly(new Date(call.createdAt)) === todayKey).length;
    const employeeTarget = Number(employee.target || 100);
    return { id: employee.id, callsToday: count, target: employeeTarget, progress: employeeTarget ? Math.min(100, Math.round(count / employeeTarget * 100)) : 0 };
  });
  return {
    leads: ownLeads.length,
    pipelineValue: ownLeads.reduce((sum, lead) => sum + Number(lead.amount || 0), 0),
    newLeadsThisWeek,
    newLeads: ownLeads.filter((lead) => lead.status === "New").length,
    interested: ownLeads.filter((lead) => lead.status === "Interested").length,
    followups: myFollowups.length,
    followupsDueToday: myFollowups.filter((item) => store.dateOnly(new Date(item.dueAt)) === todayKey).length,
    applications: ownApplications.length,
    approved: approvedApplications.length,
    converted: ownLeads.filter((lead) => lead.status === "Converted").length,
    conversionRate: ownLeads.length ? Math.round(ownLeads.filter((lead) => lead.status === "Converted").length / ownLeads.length * 100) : 0,
    callsToday: callsToday.length,
    target,
    callVolume,
    employeeMetrics: user.role === "admin" ? employeeMetrics : [],
    recentCalls: ownCalls.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6)
  };
}

async function handleApi(req, res, url) {
  const route = url.pathname;
  if (route === "/api/auth/login" && req.method === "POST") return handleLogin(req, res, await readBody(req));
  if (route === "/api/auth/logout" && req.method === "POST") {
    store.deleteSession(requestToken(req));
    const secure = process.env.NODE_ENV === "production" && secureCookieForRequest(req) ? "; Secure" : "";
    res.setHeader("Set-Cookie", `crm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
    return json(res, 200, { ok: true });
  }
  if (route === "/api/auth/change-password" && req.method === "POST") {
    const user = getUser(req);
    if (!user) return json(res, 401, { error: "Please sign in to continue" });
    const body = await readBody(req);
    const current = crypto.scryptSync(String(body.currentPassword || ""), user.salt, 64);
    if (!crypto.timingSafeEqual(current, Buffer.from(user.password_hash, "hex"))) return json(res, 400, { error: "Current password is incorrect." });
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8) return json(res, 400, { error: "New password must be at least 8 characters." });
    store.setUserPassword(user.id, body.newPassword);
    return json(res, 200, { ok: true });
  }
  if (route === "/api/auth/me" && req.method === "GET") {
    const user = getUser(req);
    return json(res, user ? 200 : 401, user ? { user: publicUser(user) } : { error: "Not signed in" });
  }

  const user = getUser(req);
  const error = requireUser(user);
  if (error) return json(res, error.status, { error: error.error });
  if (route === "/api/leads/import" && req.method === "POST") {
    if (user.role !== "admin") return json(res, 403, { error: "Admin access is required" });
    const result = importLeads(await readBody(req));
    return json(res, result.status || 201, result.status ? { error: result.error } : result);
  }
  if (route === "/api/leads/distribute" && req.method === "POST") {
    if (user.role !== "admin") return json(res, 403, { error: "Admin access is required" });
    const result = distributeLeads(await readBody(req));
    return json(res, result.status || 200, result.status ? { error: result.error } : result);
  }
  if (route === "/api/leads/reassign" && req.method === "POST") {
    if (user.role !== "admin") return json(res, 403, { error: "Admin access is required" });
    const result = reassignLeads(await readBody(req));
    return json(res, result.status || 200, result.status ? { error: result.error } : result);
  }
  if (route === "/api/documents" && req.method === "POST") {
    const { fields, file } = await readMultipart(req);
    const input = {
      ...pickFields(fields, ["leadId", "name", "type"]),
      fileName: path.basename(file.filename.replace(/\\/g, "/")),
      status: "Pending review",
      uploadedBy: user.id
    };
    if (!input.leadId || !input.name) return json(res, 400, { error: "Customer and document name are required." });
    if (!store.selectAll("leads").some((lead) => lead.id === input.leadId && (user.role === "admin" || lead.assigneeId === user.id))) return json(res, 403, { error: "You can only add documents to your assigned leads" });
    const validationError = validateInput("documents", input);
    if (validationError) return json(res, 400, { error: validationError });
    const { extension } = identifyDocument(file);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `${crypto.randomUUID()}${extension}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, file.data, { flag: "wx", mode: 0o600 });
    try {
      const document = store.insertEntity("documents", { ...input, id: crypto.randomUUID(), filePath });
      return json(res, 201, document);
    } catch (insertError) {
      fs.unlinkSync(filePath);
      throw insertError;
    }
  }
  const documentFileMatch = route.match(/^\/api\/documents\/([^/]+)\/file$/);
  if (documentFileMatch && req.method === "GET") {
    const document = store.database.prepare("SELECT id,lead_id,file_path,original_name FROM documents WHERE id=?").get(documentFileMatch[1]);
    if (!document) return json(res, 404, { error: "Document not found" });
    if (!canAccess(user, { leadId: document.lead_id })) return json(res, 403, { error: "You cannot access this document" });
    if (!document.file_path) return json(res, 404, { error: "No file is attached to this document" });
    const resolved = path.resolve(document.file_path);
    if (!resolved.startsWith(UPLOAD_DIR + path.sep)) return json(res, 403, { error: "Invalid document path" });
    let type;
    try {
      const ext = path.extname(resolved).toLowerCase();
      type = ({ ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png" })[ext];
      await fs.promises.access(resolved, fs.constants.R_OK);
    } catch {
      return json(res, 404, { error: "Document file is missing" });
    }
    if (!type) return json(res, 415, { error: "Unsupported document type" });
    const downloadName = encodeURIComponent(path.basename(document.original_name));
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": `inline; filename*=UTF-8''${downloadName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    });
    fs.createReadStream(resolved).pipe(res);
    return;
  }
  const resetPasswordMatch = route.match(/^\/api\/employees\/([^/]+)\/reset-password$/);
  if (resetPasswordMatch && req.method === "POST") {
    if (user.role !== "admin") return json(res, 403, { error: "Admin access is required" });
    const employee = store.selectAll("employees").find((item) => item.id === resetPasswordMatch[1]);
    if (!employee) return json(res, 404, { error: "Team member not found" });
    const body = await readBody(req);
    const temporaryPassword = body.password || crypto.randomBytes(12).toString("base64url");
    if (typeof temporaryPassword !== "string" || temporaryPassword.length < 8 || temporaryPassword.length > 128) return json(res, 400, { error: "Password must be between 8 and 128 characters." });
    store.setUserPassword(employee.id, temporaryPassword);
    store.deleteSessionsForUser(employee.id);
    return json(res, 200, { ok: true, temporaryPassword });
  }
  if (route === "/api/employees" && req.method === "GET") {
    const employees = store.selectAll("employees");
    return json(res, 200, user.role === "admin" ? employees : employees.map(({ id, name, role, status }) => ({ id, name, role, status })));
  }
  if (route === "/api/dashboard" && req.method === "GET") return json(res, 200, dashboardFor(user));

  const match = route.match(/^\/api\/(leads|employees|banks|schemes|applications|documents|calls|followups)(?:\/([^/]+))?$/);
  if (!match) return json(res, 404, { error: "API route not found" });
  const [, table, id] = match;
  if (["employees", "banks", "schemes"].includes(table) && user.role !== "admin" && req.method !== "GET") return json(res, 403, { error: "Admin access is required" });

  if (req.method === "GET") {
    if (table === "leads" && ["page", "pageSize", "search", "status"].some((key) => url.searchParams.has(key))) {
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 10);
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return json(res, 400, { error: "page must be positive and pageSize must be between 1 and 100." });
      const result = store.listLeads({
        userId: user.role === "staff" ? user.id : null,
        page,
        pageSize,
        search: String(url.searchParams.get("search") || "").trim().slice(0, 100),
        status: String(url.searchParams.get("status") || "")
      });
      res.setHeader("X-Total-Count", String(result.total));
      res.setHeader("X-Page", String(page));
      res.setHeader("X-Page-Size", String(pageSize));
      return json(res, 200, result.rows);
    }
    let rows = store.selectAll(table);
    if (table === "leads" && user.role !== "admin") rows = rows.filter((row) => row.assigneeId === user.id);
    else if (["banks", "schemes"].includes(table) && user.role !== "admin") rows = rows.filter((row) => row.status === "Active");
    else if (table !== "employees" && user.role !== "admin") rows = rows.filter((row) => canAccess(user, row));
    rows = table === "followups" ? rows.map((row) => ({ ...row, status: followupStatus(row) })) : rows;
    if (table === "applications") rows = rows.map((row) => ({ ...row, events: store.getApplicationEvents(row.id), availableTransitions: user.role === "admin" ? applicationTransitions[row.status] || [] : [] }));
    if (id) {
      const row = rows.find((item) => item.id === id);
      return row ? json(res, 200, row) : json(res, 404, { error: "Record not found" });
    }
    return json(res, 200, rows);
  }

  if (req.method === "POST") {
    if (user.role !== "admin" && !["leads", "calls", "followups", "applications", "documents"].includes(table)) {
      return json(res, 403, { error: "Admin access is required" });
    }
    const body = await readBody(req);
    let input = pickFields(body, writableFields[table] || []);
    if (user.role !== "admin") {
      if (table === "leads") Object.assign(input, { assigneeId: user.id, status: "New" });
      if (table === "calls" || table === "followups") input.employeeId = user.id;
      if (table === "applications") Object.assign(input, { status: "Submitted", userId: user.id });
      if (table === "documents") Object.assign(input, { status: "Pending review", uploadedBy: user.id });
      if (["calls", "followups", "applications", "documents"].includes(table) && !store.selectAll("leads").some((lead) => lead.id === input.leadId && lead.assigneeId === user.id)) return json(res, 403, { error: "You can only add records to your assigned leads" });
    }
    if (table === "employees") input.status = input.status || "Active";
    const validationError = validateInput(table, input);
    if (validationError) return json(res, 400, { error: validationError });
    if (table === "employees" && store.getUserByEmail(input.email)) return json(res, 409, { error: "An account with this email already exists" });
    if (table === "leads" && input.assigneeId && !validAssignee(input.assigneeId)) return json(res, 400, { error: "Assign leads only to active team members." });
    if (table === "applications") input.status = "Submitted";
    if (table === "calls") {
      const lead = store.selectAll("leads").find((item) => item.id === input.leadId);
      if (!lead) return json(res, 400, { error: "Select an existing customer lead." });
      const employeeId = user.role === "admin" && input.employeeId ? input.employeeId : user.id;
      const employee = store.getUserById(employeeId);
      if (!employee || !employee.active) return json(res, 400, { error: "Calls can only be assigned to an active team member." });
      const now = new Date().toISOString();
      const nextLeadStatus = ({
        Interested: "Interested",
        "Not interested": "Not interested",
        "Callback requested": "Follow-up",
        "Documents promised": "Documents"
      })[input.outcome];
      store.database.exec("BEGIN IMMEDIATE");
      try {
        const call = store.insertEntity("calls", { ...input, employeeId, createdAt: now });
        if (nextLeadStatus) store.updateEntity("leads", lead.id, { status: nextLeadStatus, lastContactAt: now });
        else store.updateEntity("leads", lead.id, { lastContactAt: now });
        if (input.followupAt) store.insertEntity("followups", { leadId: lead.id, employeeId, dueAt: input.followupAt, note: input.remarks || "Follow-up call" });
        store.database.exec("COMMIT");
        return json(res, 201, call);
      } catch (insertError) {
        store.database.exec("ROLLBACK");
        throw insertError;
      }
    }
    const row = store.insertEntity(table, { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), uploadedBy: user.id, userId: user.id });
    return json(res, 201, row);
  }

  if (req.method === "PATCH" && id) {
    const body = await readBody(req);
    if (table === "employees" && id === user.id && body.status && body.status !== "Active") return json(res, 403, { error: "You cannot deactivate your own account." });
    const row = store.selectAll(table).find((item) => item.id === id);
    if (!row) return json(res, 404, { error: "Record not found" });
    if (user.role !== "admin" && !canAccess(user, row)) return json(res, 403, { error: "You can only update records in your assigned pipeline" });
    if (user.role !== "admin" && table === "applications" && Object.keys(body).some((key) => key !== "remarks")) return json(res, 403, { error: "Staff may only update application remarks." });
    if (user.role !== "admin" && table === "documents" && Object.keys(body).length) return json(res, 403, { error: "Only administrators can update document review status." });
    if (user.role !== "admin" && ["leads", "calls", "followups"].includes(table) && ["id", "assigneeId", "employeeId", "role"].some((key) => Object.hasOwn(body, key))) return json(res, 403, { error: "You cannot change record ownership or role." });
    let changes = pickFields(body, writableFields[table] || []);
    if (Object.hasOwn(changes, "stage")) changes.status = changes.stage;
    delete changes.stage;
    if (table === "applications") {
      if (user.role !== "admin") return json(res, 200, store.updateEntity("applications", id, pickFields(changes, ["remarks"])));
      changes = pickFields(changes, ["status", "disbursedAmount", "disbursedOn", "remarks"]);
      if (changes.status === "Declined") changes.status = "Rejected";
      const currentStage = row.status;
      const nextStage = changes.status || currentStage;
      const validationError = validateInput("applications", changes, { partial: true });
      if (validationError) return json(res, 400, { error: validationError });
      if (nextStage !== currentStage && !(applicationTransitions[currentStage] || []).includes(nextStage)) return json(res, 400, { error: `Cannot move an application from ${currentStage} to ${nextStage}.` });
      if (nextStage === "Disbursed" && (changes.disbursedAmount === undefined || !changes.disbursedOn)) return json(res, 400, { error: "Disbursing a loan requires the disbursed amount and date." });
      if (nextStage === "Closed" && !String(changes.remarks || "").trim()) return json(res, 400, { error: "Add a closing note before closing this application." });
      store.database.exec("BEGIN IMMEDIATE");
      try {
        const updated = store.updateEntity("applications", id, changes);
        if (nextStage !== currentStage) {
          store.database.prepare("INSERT INTO loan_application_events (application_id,stage,by_user,note,at) VALUES (?,?,?,?,?)")
            .run(id, ({ "Under review": "under_review", "Documents pending": "documents_pending", Submitted: "submitted", Approved: "approved", Rejected: "rejected", Disbursed: "disbursed", Closed: "closed" })[nextStage], user.id, changes.remarks || "", new Date().toISOString());
        }
        if (nextStage === "Disbursed") store.updateEntity("leads", row.leadId, { status: "Converted" });
        store.database.exec("COMMIT");
        return json(res, 200, { ...updated, events: store.getApplicationEvents(id), availableTransitions: applicationTransitions[nextStage] || [] });
      } catch (updateError) {
        store.database.exec("ROLLBACK");
        throw updateError;
      }
    }
    if (table === "employees" && changes.email) {
      const existing = store.getUserByEmail(changes.email);
      if (existing && existing.id !== id) return json(res, 409, { error: "An account with this email already exists" });
    }
    if (user.role !== "admin") {
      const targetLeadId = changes.leadId || row.leadId;
      if (table !== "leads" && targetLeadId && !store.selectAll("leads").some((lead) => lead.id === targetLeadId && lead.assigneeId === user.id)) return json(res, 403, { error: "You can only update records in your assigned pipeline" });
    }
    const validationError = validateInput(table, changes, { partial: true });
    if (validationError) return json(res, 400, { error: validationError });
    if (table === "leads" && Object.hasOwn(changes, "assigneeId") && !validAssignee(changes.assigneeId)) return json(res, 400, { error: "Assign leads only to active team members." });
    if (table === "leads" && Object.hasOwn(changes, "assigneeId")) changes.assignedDate = changes.assigneeId ? store.dateOnly() : null;
    if (table === "documents" && changes.status === "Rejected" && !String(changes.rejectReason || row.rejectReason || "").trim()) return json(res, 400, { error: "A rejection reason is required." });
    if (table === "documents" && changes.status === "Verified") changes.verifiedBy = user.id;
    const updated = store.updateEntity(table, id, changes);
    return json(res, 200, updated);
  }

  if (req.method === "DELETE" && id) {
    if (user.role !== "admin") return json(res, 403, { error: "Admin access is required" });
    if (table === "employees" && id === user.id) return json(res, 403, { error: "You cannot delete your own account." });
    if (table === "employees") store.database.prepare("UPDATE leads SET assignee_id=NULL,assigned_date=NULL WHERE assignee_id=?").run(id);
    const deleted = store.deleteEntity(table, id);
    return deleted ? json(res, 200, { ok: true }) : json(res, 404, { error: "Record not found" });
  }
  return json(res, 405, { error: "Method not allowed" });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    const requestPath = decodeURIComponent(url.pathname === "/" || url.pathname === "/mobile" ? "/index.html" : url.pathname);
    const filePath = path.resolve(PUBLIC_DIR, `.${requestPath}`);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: "Forbidden" });
    fs.readFile(filePath, (readError, content) => {
      if (readError) return json(res, 404, { error: "File not found" });
      res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(content);
    });
  } catch (requestError) {
    json(res, requestError.status || 400, { error: requestError.status ? requestError.message : "The request could not be completed" });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Northstar CRM is running at http://localhost:${PORT}`));
