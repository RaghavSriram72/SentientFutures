const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-26" -> "26 Oct 2026". Parsed by hand (no Date) so it never shifts
// a day with the reader's time zone and renders the same on server and client.
export function formatDate(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) {
    return isoDate;
  }
  const year = parts[0];
  const monthIndex = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (monthIndex < 0 || monthIndex > 11 || Number.isNaN(day)) {
    return isoDate;
  }
  return `${day} ${MONTHS[monthIndex]} ${year}`;
}
