const maxPhotoBytes = 180 * 1024;
const maxEncodedPhoto = Math.ceil(maxPhotoBytes / 3) * 4;
const maxPhotoDimension = 2048;
export const maxSubmissionBytes = maxEncodedPhoto + 8192;

export interface ReportDetails {
  locationLabel: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  previouslyReported: boolean;
  photo: string | null;
}

const detailKeys: ReadonlySet<string> = new Set([
  "locationLabel", "contactName", "contactEmail", "contactPhone", "previouslyReported", "photo",
]);

export function emptyReportDetails(): ReportDetails {
  return {
    locationLabel: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    previouslyReported: false,
    photo: null,
  };
}

function optionalText(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if ([...text].length > maxLength || !text.isWellFormed() || /[\p{Cc}\p{Cf}]/u.test(text)) {
    return undefined;
  }
  return text || null;
}

function readWord(bytes: string, offset: number): number {
  return bytes.charCodeAt(offset) * 256 + bytes.charCodeAt(offset + 1);
}

function findScanEnd(bytes: string, offset: number): number {
  let marker = bytes.indexOf("\xff", offset);
  while (marker >= 0) {
    let next = marker + 1;
    while (bytes.charCodeAt(next) === 0xff) next++;
    const code = bytes.charCodeAt(next);
    if (code !== 0 && !(code >= 0xd0 && code <= 0xd7)) return marker;
    marker = bytes.indexOf("\xff", next + 1);
  }
  return -1;
}

function stripJpegMetadata(bytes: string): string | null {
  if (!bytes.startsWith("\xff\xd8") || bytes.length > maxPhotoBytes) return null;
  const segments = ["\xff\xd8"];
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  for (let markerCount = 0; markerCount < 128 && offset + 1 < bytes.length; markerCount++) {
    const start = offset;
    if (bytes.charCodeAt(offset) !== 0xff) return null;
    while (bytes.charCodeAt(offset) === 0xff) offset++;
    const marker = bytes.charCodeAt(offset++);
    if (marker === 0xd9) {
      return hasScan && offset === bytes.length ? segments.join("") + "\xff\xd9" : null;
    }

    const length = readWord(bytes, offset);
    const end = offset + length;
    if (!(length >= 2 && end <= bytes.length)) return null;
    // Remove application and comment segments, including EXIF/GPS and free-form metadata.
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      offset = end;
      continue;
    }
    if (marker === 0xc0 || marker === 0xc2) {
      const height = readWord(bytes, offset + 3);
      const width = readWord(bytes, offset + 5);
      const components = bytes.charCodeAt(offset + 7);
      if (hasFrame || length !== 8 + 3 * components || bytes.charCodeAt(offset + 2) !== 8 ||
        (components !== 1 && components !== 3) ||
        !(height >= 1 && height <= maxPhotoDimension && width >= 1 && width <= maxPhotoDimension)) {
        return null;
      }
      hasFrame = true;
    } else if (marker === 0xda) {
      const components = bytes.charCodeAt(offset + 2);
      if (!hasFrame || !(components >= 1 && components <= 3) || length !== 6 + 2 * components) {
        return null;
      }
      offset = findScanEnd(bytes, end);
      if (offset <= end) return null;
      hasScan = true;
      segments.push(bytes.slice(start, offset));
      continue;
    } else if (marker !== 0xc4 && marker !== 0xdb && marker !== 0xdd) {
      return null;
    }
    segments.push(bytes.slice(start, end));
    offset = end;
  }
  return null;
}

function optionalPhoto(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value || value.length > maxEncodedPhoto ||
    value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  try {
    const bytes = stripJpegMetadata(atob(value));
    return bytes === null ? undefined : btoa(bytes);
  } catch {
    return undefined;
  }
}

export function parseReportDetails(value: unknown): ReportDetails | null {
  if (value === undefined) return emptyReportDetails();
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !detailKeys.has(key))) return null;

  const extra = value as Record<string, unknown>;
  const locationLabel = optionalText(extra.locationLabel, 120);
  const contactName = optionalText(extra.contactName, 100);
  const contactEmail = optionalText(extra.contactEmail, 254);
  const contactPhone = optionalText(extra.contactPhone, 40);
  const { previouslyReported = false } = extra;
  const photo = optionalPhoto(extra.photo);
  if (locationLabel === undefined || contactName === undefined || contactEmail === undefined ||
    contactPhone === undefined || photo === undefined || typeof previouslyReported !== "boolean" ||
    (contactEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)) ||
    (contactPhone !== null && (!/^\+?[0-9 ().-]+$/.test(contactPhone) ||
      !/^\d{7,15}$/.test(contactPhone.replace(/\D/g, ""))))) {
    return null;
  }
  return { locationLabel, contactName, contactEmail, contactPhone, previouslyReported, photo };
}
