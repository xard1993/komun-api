import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  pgEnum,
  primaryKey,
  jsonb,
  numeric,
  date,
} from "drizzle-orm/pg-core";

export const residentRoleEnum = pgEnum("resident_role", [
  "owner",
  "tenant",
  "resident",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

export const buildings = pgTable("buildings", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id")
    .notNull()
    .references(() => buildings.id, { onDelete: "cascade" }),
  identifier: varchar("identifier", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const unitMembers = pgTable("unit_members", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(), // references public.users
  role: residentRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id"), // null = all buildings
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const announcementSeen = pgTable(
  "announcement_seen",
  {
    announcementId: integer("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.announcementId, t.userId] }),
  ]
);

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  reporterId: integer("reporter_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: ticketStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ticketComments = pgTable("ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ticketAttachments = pgTable("ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id"), // null = tenant-wide (all buildings)
  title: varchar("title", { length: 255 }).notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  uploadedBy: integer("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: varchar("entity_id", { length: 64 }),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const meetingMinutes = pgTable("meeting_minutes", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id")
    .notNull()
    .references(() => buildings.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  meetingDate: timestamp("meeting_date", { withTimezone: true }),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Building financials (running balance per building) ---
export const buildingFinancials = pgTable("building_financials", {
  buildingId: integer("building_id")
    .primaryKey()
    .references(() => buildings.id, { onDelete: "cascade" }),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const financialTransactions = pgTable("financial_transactions", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id")
    .notNull()
    .references(() => buildings.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // positive = payment in
  unitId: integer("unit_id").references(() => units.id, { onDelete: "set null" }),
  budgetPeriodId: integer("budget_period_id"), // FK to budget_periods, set when payment is for a budget period
  description: varchar("description", { length: 512 }),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Budget (yearly proposal per building) ---
export const budgetStatusEnum = pgEnum("budget_status", [
  "draft",
  "proposed",
  "approved",
  "closed",
]);

export const budgetPeriods = pgTable("budget_periods", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id")
    .notNull()
    .references(() => buildings.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  year: integer("year").notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  status: budgetStatusEnum("status").notNull().default("draft"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sentForApprovalAt: timestamp("sent_for_approval_at", { withTimezone: true }),
});

export const budgetApprovals = pgTable("budget_approvals", {
  id: serial("id").primaryKey(),
  budgetPeriodId: integer("budget_period_id")
    .notNull()
    .references(() => budgetPeriods.id, { onDelete: "cascade" }),
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 64 }).notNull().unique(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: integer("approved_by_user_id"), // references public.users
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Links documents to a budget period for resident approval view. */
export const budgetPeriodDocuments = pgTable("budget_period_documents", {
  id: serial("id").primaryKey(),
  budgetPeriodId: integer("budget_period_id")
    .notNull()
    .references(() => budgetPeriods.id, { onDelete: "cascade" }),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const budgetLineCategoryEnum = pgEnum("budget_line_category", [
  "one_time",
  "recurring",
  "extras",
]);

export const budgetLines = pgTable("budget_lines", {
  id: serial("id").primaryKey(),
  budgetPeriodId: integer("budget_period_id")
    .notNull()
    .references(() => budgetPeriods.id, { onDelete: "cascade" }),
  category: budgetLineCategoryEnum("category").notNull(),
  description: varchar("description", { length: 512 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const budgetMissingPayments = pgTable("budget_missing_payments", {
  id: serial("id").primaryKey(),
  budgetPeriodId: integer("budget_period_id")
    .notNull()
    .references(() => budgetPeriods.id, { onDelete: "cascade" }),
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 512 }),
});

export const budgetUnitContributions = pgTable("budget_unit_contributions", {
  id: serial("id").primaryKey(),
  budgetPeriodId: integer("budget_period_id")
    .notNull()
    .references(() => budgetPeriods.id, { onDelete: "cascade" }),
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
});

// --- Fee templates and unit fees ---
export const feeFrequencyEnum = pgEnum("fee_frequency", ["monthly", "yearly"]);

export const feeTemplates = pgTable("fee_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: feeFrequencyEnum("frequency").notNull(),
  buildingId: integer("building_id").references(() => buildings.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const unitFees = pgTable("unit_fees", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  feeTemplateId: integer("fee_template_id").references(() => feeTemplates.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: feeFrequencyEnum("frequency").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveUntil: date("effective_until"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
