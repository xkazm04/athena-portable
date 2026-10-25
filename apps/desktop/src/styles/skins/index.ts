/**
 * Every skin sheet, loaded by every entry — README section 3.1, ADR 0142.
 *
 * The entries import this module, never a sheet by name, so a new skin is one sheet here and one
 * entry in `SKINS` (stores/shell.ts); `styles/theme-contract.test.ts` fails if either is missing.
 * Each sheet is inert until `applySkin` writes its `data-skin`, so loading them all costs only bytes.
 */
import.meta.glob("./*.css", { eager: true });
