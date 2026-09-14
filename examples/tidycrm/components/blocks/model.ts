/**
 * `blocks` — the view model of The Blocks, in seven parts and one door.
 *
 * Client-safe: types and pure functions only, no `lib/db` import. The server
 * builds one `BkSheet` per request in `lib/blocks.ts`.
 *
 * THE VOCABULARY. the `law` direction established that a **block** is one email domain:
 * the natural cohort in this schema, the column `contacts_domain` is indexed
 * on, and the unit a company-name conflict is a deviation *within*. This
 * direction keeps that and adds one level above it. Round 1 called that level a
 * **zone** — a lettered quarter of a drawing border, holding a size band of the
 * blocks. Round 2 replaces it with a **database**: one of nine places the studio
 * actually keeps rows, owning four to seven blocks each, which on the surface
 * are called its **tables**.
 *
 * WHY THE ZONES WENT. A zone was a slice of the ident order, and the ident order
 * is descending record count, so a zone was a size band. That is a true fact
 * about the sheet and a useless one to act on: the product owner's review asked
 * L0 to answer "which database is in fault, and how many tables does it hold",
 * and a size band answers neither. The mapping that replaced it, and the nine
 * names, are `./model/databases.ts`.
 *
 * This file is the door. Everything importing `./model` keeps working, and the
 * seven parts behind it can each be read in one sitting:
 *
 *   deviations  the four kinds, and the three states a record can be in
 *   rows        one contact, and one unadjudicated identity pair
 *   tables      one block
 *   databases   the nine, where they sit, which blocks they own, and the sheet
 *   lens        the camera the one scene is seen through
 *   keys        where an arrow key moves inside a grid of cells
 *   vocabulary  finding things by id, and what a passing check says
 */
export * from "./model/deviations";
export * from "./model/rows";
export * from "./model/tables";
export * from "./model/databases";
export * from "./model/lens";
export * from "./model/keys";
export * from "./model/vocabulary";
