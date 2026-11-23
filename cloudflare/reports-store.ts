import type {
  PublishedReport,
  ReportDirectoryStore,
  TrackedReport,
  TrackingStatus,
} from "../supabase/functions/report-directory/handler.ts";
import { isCategory } from "../supabase/functions/_shared/report-category.ts";
import type { ReportSubmission, StoredReport } from "../supabase/functions/submit-report/handler.ts";
import type { ReportDetails } from "./report-details.ts";

const pageSize = 100;
const publicStatusesSql = "status in ('published', 'in_progress', 'resolved')";
const displayCategory = "coalesce(specific_category, category)";
const publicColumns = `
  request_id as publicId, ${displayCategory} as category, description, latitude, longitude,
  status, updated_at as updatedAt,
  location_label as locationLabel, previously_reported as previouslyReported,
  case when photo_base64 is not null then request_id end as photoId
`;
type QueryValue = string | number | null;

interface ReportsStatement {
  bind(...values: QueryValue[]): ReportsStatement;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<{ results: Row[] }>;
}

export interface ReportsDatabase {
  prepare(sql: string): ReportsStatement;
}

interface ModerationReport {
  request_id: string;
  tracking_number: string;
  category: string;
  description: string;
  latitude: number;
  longitude: number;
  status: TrackingStatus;
  created_at: string;
  updated_at: string;
  location_label: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  previously_reported: boolean;
  has_photo: boolean;
}

type SubmissionRow = Pick<
  ModerationReport,
  "tracking_number" | "category" | "description" | "latitude" | "longitude" |
    "location_label" | "contact_name" | "contact_email" | "contact_phone"
> & { previously_reported: number; photo_base64: string | null };
type ModerationRow = Omit<ModerationReport, "previously_reported" | "has_photo"> & {
  previously_reported: number;
  has_photo: number;
};
interface PublicRow extends PublishedReport {
  publicId: string;
  locationLabel: string | null;
  photoId: string | null;
  previouslyReported: number;
}
type StatusUpdate = Pick<ModerationReport, "status" | "updated_at">;

function publishedReport(row: PublicRow) {
  return { ...row, previouslyReported: row.previouslyReported === 1 };
}

function newTrackingNumber(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `VGG-${code.toUpperCase()}`;
}

export function createReportsStore(db: ReportsDatabase) {
  async function submit(report: ReportSubmission, details: ReportDetails): Promise<StoredReport> {
    const specificCategory = isCategory(report.category) ? null : report.category;
    const inserted = await db.prepare(`
      insert into reports (
        request_id, tracking_number, category, specific_category, description, latitude, longitude,
        location_label, contact_name, contact_email, contact_phone, previously_reported, photo_base64
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (request_id) do nothing
      returning tracking_number
    `).bind(
      report.requestId,
      newTrackingNumber(),
      specificCategory === null ? report.category : "otros",
      specificCategory,
      report.description,
      report.latitude,
      report.longitude,
      details.locationLabel,
      details.contactName,
      details.contactEmail,
      details.contactPhone,
      Number(details.previouslyReported),
      details.photo,
    ).first<Pick<SubmissionRow, "tracking_number">>();

    if (inserted) {
      return { trackingNumber: inserted.tracking_number, status: "pending_review", created: true };
    }

    const existing = await db.prepare(`
      select tracking_number, ${displayCategory} as category, description, latitude, longitude,
             location_label, contact_name, contact_email, contact_phone, previously_reported, photo_base64
      from reports where request_id = ?
    `).bind(report.requestId).first<SubmissionRow>();

    if (!existing) {
      throw new Error("Conflicting report is missing");
    }
    if (
      existing.category !== report.category ||
      existing.description !== report.description ||
      existing.latitude !== report.latitude ||
      existing.longitude !== report.longitude ||
      existing.location_label !== details.locationLabel ||
      existing.contact_name !== details.contactName ||
      existing.contact_email !== details.contactEmail ||
      existing.contact_phone !== details.contactPhone ||
      existing.previously_reported !== Number(details.previouslyReported) ||
      existing.photo_base64 !== details.photo
    ) {
      return { code: "request_conflict" };
    }

    return { trackingNumber: existing.tracking_number, status: "pending_review", created: false };
  }

  const directory: ReportDirectoryStore = {
    async list({ category, status, offset }) {
      // Scan the chronological public index for unfiltered pages instead of sorting every public row.
      const source = category === null && status === null
        ? "reports indexed by reports_public_order_idx"
        : "reports";
      const filters = [publicStatusesSql];
      const values: QueryValue[] = [];
      if (category !== null) {
        filters.push(`${displayCategory} = ?`);
        values.push(category);
      }
      if (status !== null) {
        filters.push("status = ?");
        values.push(status);
      }

      const { results } = await db.prepare(`
        select ${publicColumns}
        from ${source}
        where ${filters.join(" and ")}
        order by created_at desc, request_id desc
        limit ${pageSize + 1} offset ?
      `).bind(...values, offset).all<PublicRow>();

      return {
        reports: results.slice(0, pageSize).map(publishedReport),
        nextOffset: results.length > pageSize ? offset + pageSize : null,
      };
    },

    track(trackingNumber) {
      return db.prepare(`
        select status, updated_at as updatedAt
        from reports
        where tracking_number = ?
      `).bind(trackingNumber).first<TrackedReport>();
    },
  };

  async function getPublishedReport(requestId: string) {
    const row = await db.prepare(`
      select ${publicColumns}
      from reports where request_id = ? and ${publicStatusesSql}
    `).bind(requestId).first<PublicRow>();
    return row ? publishedReport(row) : null;
  }

  async function getReportPhoto(requestId: string, moderator: boolean) {
    const access = moderator ? "" : `and ${publicStatusesSql}`;
    const row = await db.prepare(`
      select photo_base64 from reports where request_id = ? ${access}
    `).bind(requestId).first<{ photo_base64: string | null }>();
    return row?.photo_base64 ?? null;
  }

  async function listForModeration(
    { status, offset }: { status: string | null; offset: number },
  ): Promise<ModerationReport[]> {
    const filter = status === null ? "" : "where status = ?";
    const values = status === null ? [offset] : [status, offset];
    const { results } = await db.prepare(`
      select request_id, tracking_number, ${displayCategory} as category, description, latitude, longitude,
             status, created_at, updated_at, location_label, contact_name, contact_email, contact_phone,
             previously_reported, photo_base64 is not null as has_photo
      from reports
      ${filter}
      order by created_at desc, request_id desc
      limit ${pageSize} offset ?
    `).bind(...values).all<ModerationRow>();
    return results.map((row) => ({
      ...row,
      previously_reported: row.previously_reported === 1,
      has_photo: row.has_photo === 1,
    }));
  }

  async function updateStatus(
    requestId: string,
    expected: string,
    status: string,
  ): Promise<StatusUpdate | null> {
    try {
      return await db.prepare(`
        update reports
        set status = ?1,
            updated_at = case when status <> ?1 then strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                              else updated_at end
        where request_id = ?2 and status = ?3
        returning status, updated_at
      `).bind(status, requestId, expected).first<StatusUpdate>();
    } catch (error) {
      if (error instanceof Error && error.message.includes("invalid_report_status_transition")) {
        return null;
      }
      throw error;
    }
  }

  return { submit, directory, getPublishedReport, getReportPhoto, listForModeration, updateStatus };
}
