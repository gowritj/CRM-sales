export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export const initials = (name = "") => name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
export const money = (amount) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(amount) || 0);
export const statusClass = (value) => `status status-${String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
export const badge = (value) => `<span class="${statusClass(value)}">${esc(value || "—")}</span>`;
export const avatar = (name, color) => `<span class="avatar"${color ? ` style="background:${esc(color)}"` : ""}>${esc(initials(name))}</span>`;
export const personCell = (name, detail, color) => `<div class="person-cell">${avatar(name, color)}<div><div class="person-name">${esc(name)}</div><div class="person-detail">${esc(detail)}</div></div></div>`;

export function monthlyCallVolume(calls) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - 27);
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const start = new Date(firstDay);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { day: index === 3 ? "This wk" : `${3 - index} wk${index === 2 ? "" : "s"} ago`, date: `${start.toLocaleDateString()}–${new Date(end.getTime() - 86400000).toLocaleDateString()}`, calls: 0 };
  });
  for (const call of calls) {
    const date = new Date(call.createdAt);
    date.setHours(0, 0, 0, 0);
    if (date < firstDay || date > today) continue;
    const daysAgo = Math.floor((today - date) / 86400000);
    const week = Math.min(3, Math.floor((27 - daysAgo) / 7));
    weeks[week].calls += 1;
  }
  return weeks;
}
