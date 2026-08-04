const COMBINING_MARKS = /[\u0300-\u036f]/g;
const APOSTROPHES = /['’`]/g;
const NON_ALPHANUMERIC = /[^\p{Letter}\p{Number}]+/gu;

export function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/&/g, " and ")
    .replace(APOSTROPHES, "")
    .toLocaleLowerCase("en-US")
    .replace(NON_ALPHANUMERIC, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

