const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, "data", "crm.db"));
const tableNames = {
  leads: "leads",
  employees: "users",
  banks: "banks",
  schemes: "loan_schemes",
  applications: "loan_applications",
  documents: "documents",
  calls: "calls",
  followups: "follow_ups"
};
const jsonTables = ["leads", "employees", "banks", "schemes", "applications", "documents", "calls", "followups"];
const applicationStages = {
  "Under review": "under_review",
  "Documents pending": "documents_pending",
  Submitted: "submitted",
  Approved: "approved",
  Disbursed: "disbursed",
  Rejected: "rejected",
  Closed: "closed"
};
const statuses = {
  application: { ...applicationStages, Declined: "rejected" },
  document: { "Pending review": "pending", Pending: "pending", Verified: "verified", Rejected: "rejected" }
};

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    daily_target INTEGER NOT NULL DEFAULT 100 CHECK (daily_target > 0),
    phone TEXT,
    job_title TEXT NOT NULL DEFAULT 'Loan Advisor',
    joined_at TEXT NOT NULL,
    initials TEXT,
    color TEXT
  );
  CREATE TABLE IF NOT EXISTS banks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    short_name TEXT,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    contact TEXT,
    phone TEXT
  );
  CREATE TABLE IF NOT EXISTS loan_schemes (
    id TEXT PRIMARY KEY,
    bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    rate REAL NOT NULL CHECK (rate >= 0),
    max_amount REAL NOT NULL DEFAULT 0 CHECK (max_amount >= 0),
    tenure TEXT,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive'))
  );
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT NOT NULL,
    city TEXT,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    assigned_date TEXT,
    status TEXT NOT NULL DEFAULT 'New',
    priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
    source TEXT,
    loan_type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
    last_contact_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    outcome TEXT NOT NULL,
    remarks TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 0 CHECK (duration >= 0),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS follow_ups (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    due_at TEXT NOT NULL,
    note TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Other',
    file_path TEXT,
    original_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    reject_reason TEXT,
    uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS loan_applications (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    scheme_id TEXT REFERENCES loan_schemes(id) ON DELETE SET NULL,
    bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
    stage TEXT NOT NULL DEFAULT 'submitted',
    disbursed_amount REAL,
    disbursed_on TEXT,
    remarks TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS loan_application_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id TEXT NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    by_user TEXT REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_leads_assignee_date ON leads(assignee_id, assigned_date);
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  CREATE INDEX IF NOT EXISTS idx_calls_user_created ON calls(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_calls_lead_created ON calls(lead_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_followups_user_due ON follow_ups(user_id, due_at, done);
  CREATE INDEX IF NOT EXISTS idx_documents_lead_status ON documents(lead_id, status);
  CREATE INDEX IF NOT EXISTS idx_applications_stage ON loan_applications(stage);
  CREATE INDEX IF NOT EXISTS idx_applications_lead ON loan_applications(lead_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_events_application ON loan_application_events(application_id, at);
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function daysAgo(days, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function dateOnly(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const userSeed = [
  ["usr-admin", "Olivia Carter", "admin@northstar.demo", "admin", "Administrator", "+1 (415) 555-0100", 100, true, "2023-10-01", "#ede9fe", "admin123"],
  ["usr-staff-1", "Maya Johnson", "staff@northstar.demo", "staff", "Senior Loan Advisor", "+1 (415) 555-0182", 100, true, "2024-02-14", "#dbeafe", "staff123"],
  ["usr-staff-2", "Ethan Wilson", "ethan@northstar.demo", "staff", "Loan Advisor", "+1 (415) 555-0117", 100, true, "2024-04-03", "#dcfce7", "staff123"],
  ["usr-staff-3", "Priya Patel", "priya@northstar.demo", "staff", "Loan Advisor", "+1 (415) 555-0164", 100, true, "2024-05-21", "#ffedd5", "staff123"],
  ["usr-staff-4", "Noah Davis", "noah@northstar.demo", "staff", "Loan Advisor", "+1 (415) 555-0129", 100, true, "2024-08-12", "#fce7f3", "staff123"],
  ["usr-staff-5", "Ava Thompson", "ava@northstar.demo", "staff", "Loan Advisor", "+1 (415) 555-0193", 100, false, "2025-01-08", "#cffafe", "staff123"]
];
const banksSeed = [
  { id: "bank-1", name: "First National Bank", shortName: "FNB", status: "Active", contact: "Partnerships desk", phone: "+1 (800) 555-0180" },
  { id: "bank-2", name: "Harbor Credit Union", shortName: "HCU", status: "Active", contact: "Retail lending", phone: "+1 (800) 555-0142" },
  { id: "bank-3", name: "Crescent Bank", shortName: "CB", status: "Active", contact: "Loan operations", phone: "+1 (800) 555-0198" }
];
const schemesSeed = [
  { id: "scheme-1", name: "Personal Flexi Loan", bankId: "bank-1", rate: 8.5, maxAmount: 50000, tenure: "12–60 months", status: "Active" },
  { id: "scheme-2", name: "Home Starter", bankId: "bank-2", rate: 6.9, maxAmount: 450000, tenure: "10–30 years", status: "Active" },
  { id: "scheme-3", name: "Quick Business Capital", bankId: "bank-3", rate: 9.2, maxAmount: 250000, tenure: "12–84 months", status: "Active" },
  { id: "scheme-4", name: "Auto Drive Loan", bankId: "bank-1", rate: 7.4, maxAmount: 85000, tenure: "12–72 months", status: "Active" }
];
const namesSeed = [
  ["Sophie Bennett", "San Francisco", "Personal loan", 25000, "Interested", "Website", "usr-staff-1", "High"],
  ["Liam Parker", "Oakland", "Home loan", 320000, "Follow-up", "Referral", "usr-staff-2", "Medium"],
  ["Isabella Chen", "Berkeley", "Business loan", 85000, "New", "Campaign", "usr-staff-3", "High"],
  ["Noah Williams", "Palo Alto", "Auto loan", 42000, "Documents", "Website", "usr-staff-1", "Medium"],
  ["Olivia Martinez", "San Jose", "Personal loan", 18000, "New", "Walk-in", "usr-staff-4", "Low"],
  ["Elijah Thompson", "San Francisco", "Home loan", 410000, "Interested", "Referral", "usr-staff-2", "High"],
  ["Amelia Robinson", "Walnut Creek", "Business loan", 125000, "Follow-up", "Campaign", "usr-staff-3", "Medium"],
  ["James Rodriguez", "San Francisco", "Personal loan", 12000, "Not interested", "Website", "usr-staff-4", "Low"],
  ["Mia Cooper", "Oakland", "Auto loan", 30000, "New", "Referral", null, "Medium"],
  ["Benjamin Lee", "Redwood City", "Home loan", 275000, "Interested", "Website", "usr-staff-1", "High"],
  ["Charlotte Green", "San Francisco", "Personal loan", 32000, "Follow-up", "Campaign", "usr-staff-2", "Medium"],
  ["Lucas Hall", "San Jose", "Business loan", 65000, "Documents", "Walk-in", "usr-staff-3", "High"],
  ["Evelyn King", "San Francisco", "Auto loan", 38000, "New", "Website", "usr-staff-4", "Medium"],
  ["Henry Wright", "Concord", "Personal loan", 22000, "Interested", "Referral", "usr-staff-1", "Low"],
  ["Harper Scott", "Berkeley", "Home loan", 365000, "Follow-up", "Campaign", "usr-staff-2", "High"],
  ["Alexander Adams", "San Francisco", "Business loan", 95000, "New", "Website", "usr-staff-3", "Medium"],
  ["Abigail Baker", "Mountain View", "Personal loan", 16000, "Documents", "Referral", "usr-staff-1", "Medium"],
  ["Daniel Nelson", "San Jose", "Auto loan", 28000, "Not interested", "Walk-in", "usr-staff-4", "Low"],
  ["Emily Carter", "San Francisco", "Home loan", 490000, "Interested", "Website", "usr-staff-2", "High"],
  ["Michael Mitchell", "Pleasant Hill", "Personal loan", 14000, "New", "Campaign", null, "Medium"],
  ["Ella Perez", "Oakland", "Business loan", 72000, "Follow-up", "Referral", "usr-staff-3", "High"],
  ["Sebastian Roberts", "San Francisco", "Auto loan", 35000, "Documents", "Website", "usr-staff-1", "Medium"],
  ["Grace Turner", "Palo Alto", "Personal loan", 28000, "Interested", "Campaign", "usr-staff-2", "High"],
  ["Jack Phillips", "San Jose", "Home loan", 385000, "New", "Referral", null, "Low"]
];
const applicationsSeed = [
  ["app-2001", "lead-1001", "bank-1", "scheme-1", 25000, "under_review"],
  ["app-2002", "lead-1004", "bank-1", "scheme-4", 42000, "approved"],
  ["app-2003", "lead-1006", "bank-2", "scheme-2", 410000, "submitted"],
  ["app-2004", "lead-1012", "bank-3", "scheme-3", 65000, "documents_pending"],
  ["app-2005", "lead-1010", "bank-2", "scheme-2", 275000, "disbursed"],
  ["app-2006", "lead-1015", "bank-2", "scheme-2", 365000, "under_review"],
  ["app-2007", "lead-1017", "bank-1", "scheme-1", 16000, "submitted"],
  ["app-2008", "lead-1019", "bank-2", "scheme-2", 490000, "approved"],
  ["app-2009", "lead-1022", "bank-1", "scheme-4", 35000, "documents_pending"]
];

function insertUser(values) {
  const [id, name, email, role, jobTitle, phone, target, active, joinedAt, color, password] = values;
  const { salt, hash } = hashPassword(password);
  database.prepare(`INSERT OR IGNORE INTO users (id,name,email,password_hash,salt,role,active,daily_target,phone,job_title,joined_at,initials,color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, name, email, hash, salt, role, Number(active), target, phone, jobTitle, joinedAt, name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), color);
}

function seedDatabase() {
  const insertBank = database.prepare("INSERT OR IGNORE INTO banks (id,name,short_name,status,contact,phone) VALUES (?,?,?,?,?,?)");
  const insertScheme = database.prepare("INSERT OR IGNORE INTO loan_schemes (id,bank_id,name,rate,max_amount,tenure,status) VALUES (?,?,?,?,?,?,?)");
  const insertLead = database.prepare(`INSERT OR IGNORE INTO leads (id,name,email,phone,city,assignee_id,assigned_date,status,priority,source,loan_type,amount,last_contact_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertCall = database.prepare("INSERT OR IGNORE INTO calls (id,lead_id,user_id,outcome,remarks,duration,created_at) VALUES (?,?,?,?,?,?,?)");
  const insertFollowup = database.prepare("INSERT OR IGNORE INTO follow_ups (id,lead_id,user_id,due_at,note,done) VALUES (?,?,?,?,?,?)");
  const insertApplication = database.prepare("INSERT OR IGNORE INTO loan_applications (id,lead_id,scheme_id,bank_id,user_id,amount,stage,updated_at) VALUES (?,?,?,?,?,?,?,?)");
  const insertEvent = database.prepare("INSERT INTO loan_application_events (application_id,stage,by_user,note,at) VALUES (?,?,?,?,?)");
  const insertDocument = database.prepare("INSERT OR IGNORE INTO documents (id,lead_id,name,type,file_path,original_name,status,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)");

  database.exec("BEGIN IMMEDIATE");
  try {
    userSeed.forEach(insertUser);
    banksSeed.forEach((bank) => insertBank.run(bank.id, bank.name, bank.shortName, bank.status, bank.contact, bank.phone));
    schemesSeed.forEach((scheme) => insertScheme.run(scheme.id, scheme.bankId, scheme.name, scheme.rate, scheme.maxAmount, scheme.tenure, scheme.status));
    namesSeed.forEach(([name, city, loanType, amount, status, source, assigneeId, priority], index) => {
      const id = `lead-${1001 + index}`;
      const created = new Date();
      created.setDate(created.getDate() - Math.floor(index / 4));
      insertLead.run(id, name, `${name.toLowerCase().replace(/\s+/g, ".")}@email.com`, `+1 (415) 555-${String(1000 + index).padStart(4, "0")}`, city, assigneeId, assigneeId ? dateOnly(created) : null, status, priority, source, loanType, amount, null, dateOnly(created));
    });
    const calls = [
      ["call-1", "lead-1001", "usr-staff-1", "Interested", "Looking for flexible repayment options. Sent scheme details.", 8, daysAgo(0, 10)],
      ["call-2", "lead-1002", "usr-staff-2", "Follow-up", "Requested a call after lunch.", 4, daysAgo(0, 9)],
      ["call-3", "lead-1006", "usr-staff-2", "Interested", "Pre-approved range discussed.", 12, daysAgo(1, 13)],
      ["call-4", "lead-1007", "usr-staff-3", "Follow-up", "Send updated business loan rates.", 5, daysAgo(2, 11)],
      ["call-5", "lead-1010", "usr-staff-1", "Interested", "Documents collected.", 9, daysAgo(3, 14)],
      ["call-6", "lead-1011", "usr-staff-2", "Follow-up", "Confirm monthly payment range.", 6, daysAgo(4, 10)],
      ["call-7", "lead-1012", "usr-staff-3", "Documents", "Business registration uploaded.", 11, daysAgo(5, 15)],
      ["call-8", "lead-1013", "usr-staff-4", "No answer", "Left a voicemail.", 1, daysAgo(6, 9)],
      ["call-9", "lead-1014", "usr-staff-1", "Interested", "Discussed personal loan rates.", 7, daysAgo(6, 11)]
    ];
    calls.forEach((call) => insertCall.run(...call));
    const followups = [
      ["fu-1", "lead-1002", "usr-staff-2", new Date(Date.now() + 2 * 3600000).toISOString(), "Discuss home loan options after lunch", 0],
      ["fu-2", "lead-1007", "usr-staff-3", new Date(Date.now() + 86400000).toISOString(), "Share business rates", 0],
      ["fu-3", "lead-1011", "usr-staff-2", new Date(Date.now() - 3600000).toISOString(), "Confirm monthly payment range", 0],
      ["fu-4", "lead-1015", "usr-staff-2", new Date(Date.now() + 86400000).toISOString(), "Check bank review status", 0]
    ];
    followups.forEach((followup) => insertFollowup.run(...followup));
    applicationsSeed.forEach(([id, leadId, bankId, schemeId, amount, stage], index) => {
      const at = daysAgo(index + 1);
      insertApplication.run(id, leadId, schemeId, bankId, null, amount, stage, dateOnly(new Date(at)));
      insertEvent.run(id, stage, "usr-admin", "Sample application history", at);
    });
    [
      ["doc-3001", "lead-1001", "Government ID", "Identity", "sophie-id.pdf", "verified", "usr-staff-1", dateOnly()],
      ["doc-3002", "lead-1001", "Proof of income", "Income", "income-nov.pdf", "pending", "usr-staff-1", dateOnly()],
      ["doc-3003", "lead-1004", "Vehicle invoice", "Other", "vehicle-invoice.pdf", "verified", "usr-staff-1", dateOnly(new Date(Date.now() - 86400000))],
      ["doc-3004", "lead-1012", "Business registration", "Business", "business-registration.pdf", "pending", "usr-staff-3", dateOnly(new Date(Date.now() - 2 * 86400000))],
      ["doc-3005", "lead-1017", "Bank statements", "Income", "statements-q3.pdf", "rejected", "usr-staff-1", dateOnly(new Date(Date.now() - 3 * 86400000))],
      ["doc-3006", "lead-1022", "Government ID", "Identity", "id-front.jpg", "pending", "usr-staff-1", dateOnly(new Date(Date.now() - 4 * 86400000))]
    ].forEach(([id, leadId, name, type, originalName, status, uploadedBy, uploadedAt]) => insertDocument.run(id, leadId, name, type, null, originalName, status, uploadedBy, uploadedAt));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrateLegacyJson() {
  const legacyPath = path.join(path.dirname(databasePath), "crm.json");
  if (!fs.existsSync(legacyPath)) return false;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not migrate legacy CRM data at ${legacyPath}: ${error.message}`);
  }
  if (!Array.isArray(legacy.users) || !Array.isArray(legacy.leads)) return false;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const user of legacy.users) {
      const employee = (legacy.employees || []).find((row) => row.id === user.id) || {};
      database.prepare(`INSERT OR IGNORE INTO users (id,name,email,password_hash,salt,role,active,daily_target,phone,job_title,joined_at,initials,color)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        user.id, user.name, user.email, user.passwordHash || hashPassword("staff123").hash, user.salt || "", user.role,
        Number(user.role === "admin" || employee.status !== "On leave"), Number(employee.target || 100), employee.phone || null,
        employee.role || (user.role === "admin" ? "Administrator" : "Loan Advisor"), employee.joined || dateOnly(), user.initials || null, user.color || null
      );
    }
    for (const bank of legacy.banks || []) database.prepare("INSERT OR IGNORE INTO banks (id,name,short_name,status,contact,phone) VALUES (?,?,?,?,?,?)").run(bank.id, bank.name, bank.shortName || null, bank.status || "Active", bank.contact || null, bank.phone || null);
    for (const scheme of legacy.schemes || []) database.prepare("INSERT OR IGNORE INTO loan_schemes (id,bank_id,name,rate,max_amount,tenure,status) VALUES (?,?,?,?,?,?,?)").run(scheme.id, scheme.bankId, scheme.name, scheme.rate || 0, scheme.maxAmount || 0, scheme.tenure || null, scheme.status || "Active");
    for (const lead of legacy.leads) database.prepare(`INSERT OR IGNORE INTO leads (id,name,email,phone,city,assignee_id,assigned_date,status,priority,source,loan_type,amount,last_contact_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(lead.id, lead.name, lead.email || null, lead.phone, lead.city || null, lead.assigneeId || null, lead.assigneeId ? (lead.createdAt || dateOnly()) : null, lead.status || "New", lead.priority || "Medium", lead.source || null, lead.loanType || "Personal loan", lead.amount || 0, lead.lastContact || null, lead.createdAt || dateOnly());
    for (const call of legacy.calls || []) database.prepare("INSERT OR IGNORE INTO calls (id,lead_id,user_id,outcome,remarks,duration,created_at) VALUES (?,?,?,?,?,?,?)").run(call.id, call.leadId, call.employeeId || null, call.outcome, call.remarks || "", Number(call.duration || 0), call.createdAt || new Date().toISOString());
    for (const item of legacy.followups || []) database.prepare("INSERT OR IGNORE INTO follow_ups (id,lead_id,user_id,due_at,note,done) VALUES (?,?,?,?,?,?)").run(item.id, item.leadId, item.employeeId || null, item.dueAt, item.note || "", Number(item.status === "Completed"));
    for (const item of legacy.applications || []) {
      const stage = statuses.application[item.status] || "submitted";
      database.prepare("INSERT OR IGNORE INTO loan_applications (id,lead_id,scheme_id,bank_id,user_id,amount,stage,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(item.id, item.leadId, item.schemeId || null, item.bankId, null, item.amount || 0, stage, item.updatedAt || dateOnly());
      database.prepare("INSERT INTO loan_application_events (application_id,stage,by_user,note,at) SELECT ?,?,NULL,'Migrated application',? WHERE NOT EXISTS (SELECT 1 FROM loan_application_events WHERE application_id=?)").run(item.id, stage, item.updatedAt || new Date().toISOString(), item.id);
    }
    for (const item of legacy.documents || []) database.prepare("INSERT OR IGNORE INTO documents (id,lead_id,name,type,file_path,original_name,status,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)").run(item.id, item.leadId, item.name, item.type || "Other", null, item.fileName || item.name, statuses.document[item.status] || "pending", null, item.uploadedAt || dateOnly());
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

if (database.prepare("SELECT COUNT(*) AS count FROM users").get().count === 0) {
  if (!migrateLegacyJson()) seedDatabase();
}

function parseJsonRow(table, row) {
  if (!row) return null;
  switch (table) {
    case "leads":
      return { id: row.id, name: row.name, email: row.email, phone: row.phone, city: row.city, loanType: row.loan_type, amount: row.amount, status: row.status, source: row.source, assigneeId: row.assignee_id, assignedDate: row.assigned_date, priority: row.priority, createdAt: row.created_at, lastContact: row.last_contact_at || "Not contacted", lastContactAt: row.last_contact_at };
    case "employees":
      return row.role === "admin" ? null : { id: row.id, name: row.name, email: row.email, role: row.job_title, phone: row.phone, target: row.daily_target, status: row.active ? "Active" : "On leave", joined: row.joined_at, initials: row.initials, color: row.color, active: Boolean(row.active) };
    case "banks":
      return { id: row.id, name: row.name, shortName: row.short_name, status: row.status, contact: row.contact, phone: row.phone };
    case "schemes":
      return { id: row.id, name: row.name, bankId: row.bank_id, rate: row.rate, maxAmount: row.max_amount, tenure: row.tenure, status: row.status };
    case "applications":
      return { id: row.id, leadId: row.lead_id, bankId: row.bank_id, schemeId: row.scheme_id, userId: row.user_id, amount: row.amount, status: Object.entries(applicationStages).find(([, value]) => value === row.stage)?.[0] || row.stage, stage: row.stage, updatedAt: row.updated_at, disbursedAmount: row.disbursed_amount, disbursedOn: row.disbursed_on, remarks: row.remarks };
    case "documents":
      return { id: row.id, leadId: row.lead_id, name: row.name, type: row.type, fileName: row.original_name, hasFile: Boolean(row.file_path), status: ({ pending: "Pending review", verified: "Verified", rejected: "Rejected" })[row.status] || row.status, rejectReason: row.reject_reason, uploadedAt: row.uploaded_at, uploadedBy: row.uploaded_by, verifiedBy: row.verified_by };
    case "calls":
      return { id: row.id, leadId: row.lead_id, employeeId: row.user_id, outcome: row.outcome, remarks: row.remarks, duration: row.duration, createdAt: row.created_at };
    case "followups":
      return { id: row.id, leadId: row.lead_id, employeeId: row.user_id, dueAt: row.due_at, note: row.note, done: Boolean(row.done), status: row.done ? "Completed" : new Date(row.due_at).getTime() < Date.now() ? "Overdue" : "Scheduled" };
    default:
      return { ...row };
  }
}

function selectAll(table) {
  const sqlTable = tableNames[table];
  if (!sqlTable) throw new Error(`Unknown table: ${table}`);
  const rows = table === "employees"
    ? database.prepare("SELECT * FROM users ORDER BY name").all()
    : database.prepare(`SELECT * FROM ${sqlTable}`).all();
  return rows.map((row) => parseJsonRow(table, row)).filter(Boolean);
}

function listLeads({ userId = null, page = 1, pageSize = 10, search = "", status = "" } = {}) {
  const conditions = [];
  const values = [];
  if (userId) {
    conditions.push("l.assignee_id=?");
    values.push(userId);
  }
  if (status && status !== "All statuses") {
    conditions.push("l.status=?");
    values.push(status);
  }
  if (search) {
    conditions.push("LOWER(l.name || ' ' || COALESCE(l.email,'') || ' ' || l.phone || ' ' || COALESCE(l.city,'') || ' ' || l.loan_type || ' ' || l.status || ' ' || COALESCE(l.source,'') || ' ' || COALESCE(u.name,'')) LIKE ?");
    values.push(`%${search.toLowerCase()}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = database.prepare(`SELECT COUNT(*) AS count FROM leads l LEFT JOIN users u ON u.id=l.assignee_id ${where}`).get(...values).count;
  const rows = database.prepare(`SELECT l.* FROM leads l LEFT JOIN users u ON u.id=l.assignee_id ${where}
    ORDER BY l.created_at DESC,l.id LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize);
  return { rows: rows.map((row) => parseJsonRow("leads", row)), total };
}

function getUserById(id) {
  return database.prepare("SELECT * FROM users WHERE id=?").get(id) || null;
}

function getUserByEmail(email) {
  return database.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(email) || null;
}

function getApplicationEvents(applicationId) {
  return database.prepare("SELECT id, application_id AS applicationId, stage, by_user AS byUser, note, at FROM loan_application_events WHERE application_id=? ORDER BY at,id").all(applicationId);
}

function insertEntity(table, row) {
  const id = row.id || `${table.slice(0, -1)}-${crypto.randomUUID().slice(0, 8)}`;
  if (table === "employees") {
    const credentials = hashPassword(row.password || "welcome123");
    database.prepare(`INSERT INTO users (id,name,email,password_hash,salt,role,active,daily_target,phone,job_title,joined_at,initials,color)
      VALUES (?,?,?,?,?,'staff',?,?,?,?,?,?,?)`).run(id, row.name, row.email, credentials.hash, credentials.salt, Number(row.status !== "On leave" && row.status !== "Inactive"), Number(row.target || 100), row.phone || null, row.role || "Loan Advisor", row.joined || dateOnly(), row.initials || row.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), row.color || "#dbeafe");
    return selectAll(table).find((item) => item.id === id);
  }
  if (table === "leads") {
    database.prepare(`INSERT INTO leads (id,name,email,phone,city,assignee_id,assigned_date,status,priority,source,loan_type,amount,last_contact_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, row.name, row.email || null, row.phone, row.city || null, row.assigneeId || null, row.assigneeId ? row.assignedDate || dateOnly() : null, row.status || "New", row.priority || "Medium", row.source || null, row.loanType || "Personal loan", Number(row.amount || 0), row.lastContactAt || row.lastContact || null, row.createdAt || dateOnly());
  } else if (table === "banks") {
    database.prepare("INSERT INTO banks (id,name,short_name,status,contact,phone) VALUES (?,?,?,?,?,?)").run(id, row.name, row.shortName || null, row.status || "Active", row.contact || null, row.phone || null);
  } else if (table === "schemes") {
    database.prepare("INSERT INTO loan_schemes (id,bank_id,name,rate,max_amount,tenure,status) VALUES (?,?,?,?,?,?,?)").run(id, row.bankId, row.name, Number(row.rate || 0), Number(row.maxAmount || 0), row.tenure || null, row.status || "Active");
  } else if (table === "applications") {
    const stage = statuses.application[row.status] || "submitted";
    database.prepare("INSERT INTO loan_applications (id,lead_id,scheme_id,bank_id,user_id,amount,stage,disbursed_amount,disbursed_on,remarks,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, row.leadId, row.schemeId || null, row.bankId, row.userId || null, Number(row.amount || 0), stage, row.disbursedAmount || null, row.disbursedOn || null, row.remarks || "", dateOnly());
    database.prepare("INSERT INTO loan_application_events (application_id,stage,by_user,note,at) VALUES (?,?,?,?,?)").run(id, stage, row.userId || null, row.remarks || "", new Date().toISOString());
  } else if (table === "documents") {
    database.prepare("INSERT INTO documents (id,lead_id,name,type,file_path,original_name,status,reject_reason,uploaded_by,verified_by,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, row.leadId, row.name, row.type || "Other", row.filePath || null, row.fileName || row.originalName || row.name, statuses.document[row.status] || "pending", row.rejectReason || null, row.uploadedBy || null, row.verifiedBy || null, row.uploadedAt || dateOnly());
  } else if (table === "calls") {
    database.prepare("INSERT INTO calls (id,lead_id,user_id,outcome,remarks,duration,created_at) VALUES (?,?,?,?,?,?,?)").run(id, row.leadId, row.employeeId || row.userId || null, row.outcome, row.remarks || "", Number(row.duration || 0), row.createdAt || new Date().toISOString());
  } else if (table === "followups") {
    database.prepare("INSERT INTO follow_ups (id,lead_id,user_id,due_at,note,done) VALUES (?,?,?,?,?,?)").run(id, row.leadId, row.employeeId || row.userId || null, row.dueAt, row.note || "", Number(row.done || row.status === "Completed"));
  } else {
    throw new Error(`Unknown table: ${table}`);
  }
  return selectAll(table).find((item) => item.id === id);
}

function updateEntity(table, id, changes) {
  const columns = {
    leads: { name: "name", email: "email", phone: "phone", city: "city", loanType: "loan_type", amount: "amount", status: "status", source: "source", assigneeId: "assignee_id", assignedDate: "assigned_date", priority: "priority", createdAt: "created_at", lastContact: "last_contact_at", lastContactAt: "last_contact_at" },
    employees: { name: "name", email: "email", phone: "phone", role: "job_title", target: "daily_target", status: "active", joined: "joined_at", initials: "initials", color: "color" },
    banks: { name: "name", shortName: "short_name", status: "status", contact: "contact", phone: "phone" },
    schemes: { name: "name", bankId: "bank_id", rate: "rate", maxAmount: "max_amount", tenure: "tenure", status: "status" },
    applications: { leadId: "lead_id", bankId: "bank_id", schemeId: "scheme_id", amount: "amount", status: "stage", disbursedAmount: "disbursed_amount", disbursedOn: "disbursed_on", remarks: "remarks" },
    documents: { name: "name", type: "type", filePath: "file_path", fileName: "original_name", status: "status", rejectReason: "reject_reason", verifiedBy: "verified_by" },
    calls: { outcome: "outcome", remarks: "remarks", duration: "duration" },
    followups: { dueAt: "due_at", note: "note", status: "done", done: "done" }
  };
  const mapping = columns[table];
  if (!mapping) throw new Error(`Unknown table: ${table}`);
  const entries = Object.entries(changes).filter(([key]) => mapping[key]);
  if (!entries.length) return selectAll(table).find((item) => item.id === id) || null;
  const values = entries.map(([key, value]) => {
    if (table === "employees" && key === "status") return Number(value !== "On leave" && value !== "Inactive");
    if (table === "applications" && key === "status") return statuses.application[value] || value;
    if (table === "documents" && key === "status") return statuses.document[value] || value;
    if (table === "followups" && (key === "status" || key === "done")) return Number(value === true || value === 1 || value === "Completed");
    return value;
  });
  const setClause = entries.map(([key]) => `${mapping[key]}=?`).join(",");
  const update = () => {
    database.prepare(`UPDATE ${tableNames[table]} SET ${setClause}${table === "applications" ? ",updated_at=?" : ""} WHERE id=?`)
      .run(...values, ...(table === "applications" ? [dateOnly()] : []), id);
  };
  update();
  if (table === "employees" && Object.hasOwn(changes, "status") && changes.status !== "Active") deleteSessionsForUser(id);
  return selectAll(table).find((item) => item.id === id) || null;
}

function setUserPassword(id, password) {
  const credentials = hashPassword(password);
  return database.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=?").run(credentials.hash, credentials.salt, id).changes > 0;
}

function deleteEntity(table, id) {
  if (table === "employees") return database.prepare("DELETE FROM users WHERE id=? AND role='staff'").run(id).changes > 0;
  return database.prepare(`DELETE FROM ${tableNames[table]} WHERE id=?`).run(id).changes > 0;
}

function createSession(token, userId, expiresAt) {
  database.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(token, userId, expiresAt);
}

function getSession(token) {
  if (!token) return null;
  const session = database.prepare("SELECT * FROM sessions WHERE token=? AND expires_at>?").get(token, new Date().toISOString());
  if (!session) {
    database.prepare("DELETE FROM sessions WHERE token=? OR expires_at<=?").run(token, new Date().toISOString());
    return null;
  }
  return { ...session, user: getUserById(session.user_id) };
}

function deleteSession(token) {
  if (token) database.prepare("DELETE FROM sessions WHERE token=?").run(token);
}

function deleteSessionsForUser(userId) {
  database.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}

module.exports = {
  database,
  databasePath,
  createSession,
  dateOnly,
  deleteEntity,
  deleteSession,
  deleteSessionsForUser,
  getSession,
  getApplicationEvents,
  getUserByEmail,
  getUserById,
  insertEntity,
  listLeads,
  parseJsonRow,
  selectAll,
  setUserPassword,
  tableNames,
  updateEntity
};
