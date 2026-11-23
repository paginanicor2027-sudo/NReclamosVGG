import type {
  Category,
  PublishedReport,
  ReportDirectoryStore,
  TrackedReport,
  TrackingStatus,
} from "../supabase/functions/report-directory/handler.ts";
import type { ReportStore } from "../supabase/functions/submit-report/handler.ts";

const pageSize = 100;
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
  category: Category;
  description: string;
  latitude: number;
  longitude: number;
  status: TrackingStatus;
  created_at: string;
  updated_at: string;
}

type SubmissionRow = Pick<
  ModerationReport,
  "tracking_number" | "category" | "description" | "latitude" | "longitude"
>;
type StatusUpdate = Pick<ModerationReport, "status" | "updated_at">;

function newTrackingNumber(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `VGG-${code.toUpperCase()}`;
}

export function createReportsStore(db: ReportsDatabase) {
  const submit: ReportStore = async (report) => {
    const inserted = await db.prepare(`
      insert into reports (request_id, tracking_number, category, description, latitude, longitude)
      values (?, ?, ?, ?, ?, ?)
      on conflict (request_id) do nothing
      returning tracking_number
    `).bind(
      report.requestId,
      newTrackingNumber(),
      report.category,
      report.description,
      report.latitude,
      report.longitude,
    ).first<Pick<SubmissionRow, "tracking_number">>();

    if (inserted) {
      return { trackingNumber: inserted.tracking_number, status: "pending_review", created: true };
    }

    const existing = await db.prepare(`
      select tracking_number, category, description, latitude, longitude
      from reports where request_id = ?
    `).bind(report.requestId).first<SubmissionRow>();

    if (!existing) {
      throw new Error("Conflicting report is missing");
    }
    if (
      existing.category !== report.category ||
      existing.description !== report.description ||
      existing.latitude !== report.latitude ||
      existing.longitude !== report.longitude
    ) {
      return { code: "request_conflict" };
    }

    return { trackingNumber: existing.tracking_number, status: "pending_review", created: false };
  };

  const directory: ReportDirectoryStore = {
    async list({ category, status, offset }) {
      // Scan the chronological public index for unfiltered pages instead of sorting every public row.
      const source = category === null && status === null
        ? "reports indexed by reports_public_order_idx"
        : "reports";
      const filters = ["status in ('published', 'in_progress', 'resolved')"];
      const values: QueryValue[] = [];
      if (category !== null) {
        filters.push("category = ?");
        values.push(category);
      }
      if (status !== null) {
        filters.push("status = ?");
        values.push(status);
      }

      const { results } = await db.prepare(`
        select category, description, latitude, longitude, status, updated_at as updatedAt
        from ${source}
        where ${filters.join(" and ")}
        order by created_at desc, request_id desc
        limit ${pageSize + 1} offset ?
      `).bind(...values, offset).all<PublishedReport>();

      return {
        reports: results.slice(0, pageSize),
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

  async function listForModeration(
    { status, offset }: { status: string | null; offset: number },
  ): Promise<ModerationReport[]> {
    const filter = status === null ? "" : "where status = ?";
    const values = status === null ? [offset] : [status, offset];
    const { results } = await db.prepare(`
      select request_id, tracking_number, category, description, latitude, longitude,
             status, created_at, updated_at
      from reports
      ${filter}
      order by created_at desc, request_id desc
      limit ${pageSize} offset ?
    `).bind(...values).all<ModerationReport>();
    return results;
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

  return { submit, directory, listForModeration, updateStatus };
}
