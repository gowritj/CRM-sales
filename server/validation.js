const requiredFields = {
  leads: ["name", "phone", "loanType", "status"],
  employees: ["name", "email", "role"],
  banks: ["name", "status"],
  schemes: ["name", "bankId", "rate"],
  applications: ["leadId", "bankId", "status"],
  documents: ["leadId", "name", "fileName", "status"],
  calls: ["leadId", "outcome"],
  followups: ["leadId", "employeeId", "dueAt", "note"]
};

const allowedValues = {
  leads: { status: ["New", "Interested", "Not interested", "Follow-up", "Documents", "Converted"], priority: ["High", "Medium", "Low"], loanType: ["Personal loan", "Home loan", "Business loan", "Auto loan"] },
  employees: { status: ["Active", "On leave", "Inactive"] },
  banks: { status: ["Active", "Inactive"] },
  documents: { status: ["Pending review", "Verified", "Rejected"], type: ["Identity", "Income", "Address", "Business", "Other"] },
  applications: { status: ["Documents pending", "Submitted", "Under review", "Approved", "Disbursed", "Declined", "Rejected", "Closed"] },
  calls: { outcome: ["Interested", "Not interested", "Callback requested", "No answer", "Busy", "Wrong number", "Documents promised"] }
};

function pickFields(input, allowed) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)));
}

function validateInput(table, input, { partial = false } = {}) {
  const missing = (requiredFields[table] || []).filter((field) => !partial && (input[field] === undefined || input[field] === null || input[field] === ""));
  if (missing.length) return `Required fields: ${missing.join(", ")}`;
  if (input.phone !== undefined) {
    const digits = String(input.phone).replace(/\D/g, "");
    if (!/^[+()\d.\s-]+$/.test(String(input.phone)) || digits.length < 7 || digits.length > 15) return "Phone number must contain 7 to 15 digits.";
  }
  if (input.email !== undefined && input.email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email))) return "Enter a valid email address.";
  for (const key of ["amount", "target", "rate", "maxAmount", "duration", "disbursedAmount"]) {
    if (input[key] !== undefined && (!Number.isFinite(Number(input[key])) || Number(input[key]) < (key === "target" ? 1 : 0))) return `${key} must be a valid non-negative number.`;
  }
  for (const [field, values] of Object.entries(allowedValues[table] || {})) {
    if (input[field] !== undefined && !values.includes(input[field])) return `${field} must be one of: ${values.join(", ")}.`;
  }
  if (input.stage !== undefined && !allowedValues.applications.status.includes(input.stage)) return `stage must be one of: ${allowedValues.applications.status.join(", ")}.`;
  for (const field of ["dueAt", "followupAt"]) {
    if (input[field] && Number.isNaN(Date.parse(input[field]))) return `Enter a valid ${field === "dueAt" ? "follow-up" : "call follow-up"} date and time.`;
  }
  if (input.disbursedOn !== undefined && input.disbursedOn !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(input.disbursedOn) || Number.isNaN(Date.parse(`${input.disbursedOn}T00:00:00Z`)))) return "Enter a valid disbursement date.";
  return null;
}

module.exports = { allowedValues, pickFields, validateInput };
