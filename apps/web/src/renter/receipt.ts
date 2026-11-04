import type { Bill } from "../api.js";
import { dateTime, kwh, npr, period, shortId } from "../lib/format.js";
import { amountDue } from "./useRenterData.js";

export interface ReceiptDetails {
  propertyName?: string;
  propertyAddress?: string;
  roomName?: string;
  roomFloor?: string;
  renterName: string;
  renterEmail?: string;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const statusLabel = (bill: Bill) =>
  bill.status === "paid" ? "PAID" : bill.status === "issued" ? "AMOUNT DUE" : "DRAFT";

function rows(bill: Bill): Array<[string, string]> {
  return [
    ["Billing period", period(bill.periodStart, bill.periodEnd)],
    ["Meter reading at start", `${bill.startingCumulativeKwh.toFixed(3)} kWh`],
    ["Meter reading at end", `${bill.endingCumulativeKwh.toFixed(3)} kWh`],
    ["Electricity used", kwh(bill.consumptionKwh)],
    ["Rate", `${npr(bill.rateNprPerKwh)} / kWh`],
    ["Electricity charge", npr(bill.electricityChargeNpr)],
    ...(bill.creditNpr ? ([["Courtesy credit", `- ${npr(bill.creditNpr)}`]] as Array<[string, string]>) : [])
  ];
}

export function buildReceiptHtml(bill: Bill, details: ReceiptDetails): string {
  const tableRows = rows(bill)
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td class="right">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>ChargeMesh receipt ${escapeHtml(shortId(bill.billId))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; margin: 0; padding: 40px; background: #f8fafc; }
  .sheet { max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 36px; }
  .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; }
  .brand h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }
  .brand p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
  .meta { text-align: right; font-size: 12px; color: #64748b; line-height: 1.6; }
  .meta strong { color: #0f172a; display: block; font-size: 13px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; font-size: 13px; }
  .parties h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin: 0 0 6px; }
  .parties p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 9px 0; border-bottom: 1px solid #f1f5f9; color: #475569; }
  td.right { text-align: right; font-weight: 600; color: #0f172a; }
  .total { margin-top: 20px; padding: 18px 20px; border-radius: 12px; background: #eff6ff; border: 1px solid #dbeafe; display: flex; justify-content: space-between; align-items: center; }
  .total span { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #1e40af; }
  .total strong { font-size: 26px; color: #1d4ed8; letter-spacing: -0.02em; }
  .status { display: inline-block; margin-top: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid #e2e8f0; color: #475569; }
  .status.paid { background: #ecfdf5; color: #047857; border-color: #d1fae5; }
  .status.issued { background: #fffbeb; color: #b45309; border-color: #fef3c7; }
  .note { margin-top: 24px; font-size: 11px; line-height: 1.7; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: 0; padding: 12px; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      <div class="brand">
        <h1>ChargeMesh</h1>
        <p>Electricity &amp; Rent Billing · Payment receipt</p>
      </div>
      <div class="meta">
        <strong>${escapeHtml(shortId(bill.billId))}</strong>
        <div>Bill ID ${escapeHtml(bill.billId)}</div>
        <div>Issued ${escapeHtml(dateTime(bill.issuedAt))}</div>
        <span class="status ${bill.status === "paid" ? "paid" : bill.status === "issued" ? "issued" : ""}">${statusLabel(bill)}</span>
      </div>
    </div>

    <div class="parties">
      <div>
        <h2>Billed to</h2>
        <p><strong>${escapeHtml(details.renterName)}</strong></p>
        ${details.renterEmail ? `<p>${escapeHtml(details.renterEmail)}</p>` : ""}
        ${details.propertyName ? `<p>${escapeHtml(details.propertyName)}</p>` : ""}
        ${details.propertyAddress ? `<p>${escapeHtml(details.propertyAddress)}</p>` : ""}
        ${details.roomName ? `<p>Room ${escapeHtml(details.roomName)}${details.roomFloor ? ` · ${escapeHtml(details.roomFloor)}` : ""}</p>` : ""}
      </div>
      <div>
        <h2>Bill details</h2>
        <p>Period: ${escapeHtml(period(bill.periodStart, bill.periodEnd))}</p>
        <p>Currency: ${escapeHtml(bill.currency ?? "USD")}</p>
        <p>${bill.paidAt ? `Paid on ${escapeHtml(dateTime(bill.paidAt))}` : "Payment not recorded yet"}</p>
      </div>
    </div>

    <table>${tableRows}</table>

    <div class="total">
      <span>${bill.status === "paid" ? "Amount paid" : "Amount due"}</span>
      <strong>${escapeHtml(npr(amountDue(bill)))}</strong>
    </div>

    <p class="note">
      This bill is calculated only from signed readings of the room sub-meter. Both the renter and the
      landlord see the same meter ledger. Keep this receipt for your records.
    </p>
  </div>
</body>
</html>`;
}

export function printReceipt(bill: Bill, details: ReceiptDetails): void {
  const popup = window.open("", "_blank", "width=820,height=940");
  if (!popup) return;
  popup.document.write(buildReceiptHtml(bill, details));
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
}

export function downloadReceipt(bill: Bill, details: ReceiptDetails): void {
  const html = buildReceiptHtml(bill, details);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chargemesh-receipt-${bill.billId}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
