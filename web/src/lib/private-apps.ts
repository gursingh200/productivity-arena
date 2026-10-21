/**
 * Private apps never count: time in them isn't human or meeting time and
 * isn't listed. Macs from 0.1.20 don't send it; ingest drops it from older
 * Macs. Time stored before then is left as it was.
 */
export const PRIVATE_APP = "private";
