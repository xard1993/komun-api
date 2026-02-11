/**
 * Stub for sending notifications (email / WhatsApp).
 * Replace with real provider (SendGrid, Mailgun, Twilio, etc.).
 */

const BASE_URL = process.env.CORS_ORIGIN ?? "http://localhost:3000";

export interface BudgetApprovalRecipient {
  email: string;
  name: string | null;
  unitIdentifier: string;
  token: string;
  tenantSlug: string;
  periodId: number;
  periodName: string;
  year: number;
  sharePerUnit: string;
}

/** Send budget approval request via email (stub: logs only). */
export async function sendBudgetApprovalEmail(recipient: BudgetApprovalRecipient): Promise<void> {
  const approveUrl = `${BASE_URL}/t/${recipient.tenantSlug}/budget/${recipient.periodId}/approve?token=${encodeURIComponent(recipient.token)}`;
  // Avoid duplicate "Budget" in subject (e.g. "Budget Budget 2026" -> "Budget 2026")
  const name = recipient.periodName.trim();
  const title = /^Budget\s+Budget\s+/i.test(name) ? name.replace(/^Budget\s+/i, "") : name;
  const subject = `${title} (${recipient.year}) – approval requested`;
  // TODO: integrate with SendGrid, Mailgun, etc.
  console.log("[notify] Budget approval email (stub)", {
    to: recipient.email,
    subject,
    approveUrl,
  });
}

/** Send budget approval request via WhatsApp (stub: logs only). */
export async function sendBudgetApprovalWhatsApp(recipient: BudgetApprovalRecipient): Promise<void> {
  const approveUrl = `${BASE_URL}/t/${recipient.tenantSlug}/budget/${recipient.periodId}/approve?token=${encodeURIComponent(recipient.token)}`;
  const name = recipient.periodName.trim();
  const title = /^Budget\s+Budget\s+/i.test(name) ? name.replace(/^Budget\s+/i, "") : name;
  const message = `${title} (${recipient.year}) – please approve: ${approveUrl}`;
  // TODO: integrate with Twilio WhatsApp API, etc.
  console.log("[notify] Budget approval WhatsApp (stub)", {
    to: recipient.email, // or phone
    message,
  });
}
