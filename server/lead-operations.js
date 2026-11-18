function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function parseCsvRows(text) {
  const records = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell !== "")) records.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw Object.assign(new Error("A CSV value has an unclosed quote."), { status: 400 });
  row.push(value.trim());
  if (row.some((cell) => cell !== "")) records.push(row);
  if (records.length < 2) throw Object.assign(new Error("CSV needs a header row and at least one lead."), { status: 400 });
  const headers = records[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return records.slice(1).map((cells, index) => ({
    rowNumber: index + 2,
    data: Object.fromEntries(headers.map((header, cell) => [header, cells[cell] || ""]))
  }));
}

function normalizeLeadImportRow(row) {
  const source = row.data || row;
  const normalized = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]+/g, ""), value]));
  const phone = normalized.phone || "";
  const amountText = String(normalized.amount || "0").replace(/[$,]/g, "");
  return {
    name: String(normalized.name || "").trim(),
    email: String(normalized.email || "").trim(),
    phone: String(phone).trim(),
    city: String(normalized.city || "").trim(),
    loanType: normalized.loantype || normalized.loan || "Personal loan",
    amount: amountText.trim() ? Number(amountText) : 0,
    status: normalized.status || "New",
    source: normalized.source || "CSV import",
    priority: normalized.priority || "Medium",
    assigneeId: null,
    assignedDate: null,
    lastContact: "Not contacted",
    createdAt: new Date().toISOString().slice(0, 10)
  };
}

function createLeadOperations(store, validateInput) {
  function importLeads(input) {
    const sourceRows = Array.isArray(input.rows) ? input.rows.map((data, index) => ({ rowNumber: index + 1, data })) : typeof input.csv === "string" ? parseCsvRows(input.csv) : null;
    if (!sourceRows) return { error: "Provide parsed lead rows or CSV text.", status: 400 };
    if (sourceRows.length > 5000) return { error: "Import up to 5,000 leads at a time.", status: 400 };
    const invalid = [];
    let duplicates = 0;
    let imported = 0;
    store.database.exec("BEGIN IMMEDIATE");
    try {
      const knownPhones = new Set(store.database.prepare("SELECT phone FROM leads").all().map(({ phone }) => normalizePhone(phone)));
      for (const source of sourceRows) {
        const row = normalizeLeadImportRow(source);
        const validationError = validateInput("leads", row);
        if (validationError) {
          invalid.push({ row: source.rowNumber, reason: validationError });
          continue;
        }
        const phone = normalizePhone(row.phone);
        if (knownPhones.has(phone)) {
          duplicates += 1;
          continue;
        }
        store.insertEntity("leads", row);
        knownPhones.add(phone);
        imported += 1;
      }
      store.database.exec("COMMIT");
      return { imported, duplicates, invalid };
    } catch (error) {
      store.database.exec("ROLLBACK");
      throw error;
    }
  }

  function distributeLeads(input) {
    if (input.mode !== "equal") return { error: 'Distribution mode must be "equal".', status: 400 };
    const rawLimit = input.limit === undefined || input.limit === null || input.limit === "" ? 5000 : Number(input.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 5000) return { error: "Limit must be an integer between 1 and 5,000.", status: 400 };
    if (input.staffIds !== undefined && (!Array.isArray(input.staffIds) || input.staffIds.some((id) => typeof id !== "string"))) return { error: "staffIds must be an array of team member IDs.", status: 400 };
    const requestedIds = Array.isArray(input.staffIds) ? [...new Set(input.staffIds)] : [];
    const hasSelection = Array.isArray(input.staffIds);
    store.database.exec("BEGIN IMMEDIATE");
    try {
      const team = store.selectAll("employees");
      if (requestedIds.some((id) => !team.some((employee) => employee.id === id))) {
        store.database.exec("ROLLBACK");
        return { error: "One or more selected team members do not exist.", status: 400 };
      }
      const active = team.filter((employee) => employee.active && (!hasSelection || requestedIds.includes(employee.id)));
      const unassigned = store.selectAll("leads").filter((lead) => !lead.assigneeId).slice(0, rawLimit);
      const today = store.dateOnly();
      const countsByEmployee = new Map(active.map((employee) => {
        const assignedToday = store.database.prepare("SELECT COUNT(*) AS count FROM leads WHERE assignee_id=? AND assigned_date=?").get(employee.id, today).count;
        return [employee.id, { count: 0, remaining: Math.max(0, employee.target - assignedToday) }];
      }));
      let cursor = 0;
      for (const lead of unassigned) {
        let selected = null;
        for (let attempt = 0; attempt < active.length; attempt += 1) {
          const candidate = active[cursor % active.length];
          cursor = (cursor + 1) % Math.max(active.length, 1);
          if (countsByEmployee.get(candidate.id).remaining > 0) {
            selected = candidate;
            break;
          }
        }
        if (!selected) break;
        store.updateEntity("leads", lead.id, { assigneeId: selected.id, assignedDate: today });
        const counts = countsByEmployee.get(selected.id);
        counts.count += 1;
        counts.remaining -= 1;
      }
      store.database.exec("COMMIT");
      return {
        assigned: [...countsByEmployee.values()].reduce((sum, item) => sum + item.count, 0),
        counts: active.map((employee) => ({ staffId: employee.id, name: employee.name, count: countsByEmployee.get(employee.id).count, remaining: countsByEmployee.get(employee.id).remaining }))
      };
    } catch (error) {
      store.database.exec("ROLLBACK");
      throw error;
    }
  }

  function reassignLeads(input) {
    if (!Array.isArray(input.leadIds) || !input.leadIds.length || input.leadIds.length > 500 || input.leadIds.some((id) => typeof id !== "string")) return { error: "Select between 1 and 500 leads to reassign.", status: 400 };
    store.database.exec("BEGIN IMMEDIATE");
    try {
      const employee = store.selectAll("employees").find((item) => item.id === input.staffId && item.active);
      if (!employee) {
        store.database.exec("ROLLBACK");
        return { error: "Choose an active team member.", status: 400 };
      }
      const leads = store.selectAll("leads").filter((lead) => input.leadIds.includes(lead.id));
      if (leads.length !== new Set(input.leadIds).size) {
        store.database.exec("ROLLBACK");
        return { error: "One or more selected leads no longer exist.", status: 400 };
      }
      const today = store.dateOnly();
      const alreadyAssignedToday = store.database.prepare("SELECT COUNT(*) AS count FROM leads WHERE assignee_id=? AND assigned_date=?").get(employee.id, today).count;
      const capacityNeeded = leads.filter((lead) => lead.assigneeId !== employee.id || lead.assignedDate !== today).length;
      if (alreadyAssignedToday + capacityNeeded > employee.target) {
        store.database.exec("ROLLBACK");
        return { error: `${employee.name} has reached their daily assignment target.`, status: 409 };
      }
      for (const lead of leads) store.updateEntity("leads", lead.id, { assigneeId: employee.id, assignedDate: today });
      store.database.exec("COMMIT");
      return { reassigned: leads.length, staffId: employee.id, name: employee.name };
    } catch (error) {
      store.database.exec("ROLLBACK");
      throw error;
    }
  }

  return { distributeLeads, importLeads, reassignLeads };
}

module.exports = createLeadOperations;
