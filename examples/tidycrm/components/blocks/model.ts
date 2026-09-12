/**
 * `blocks` — the view model of The Blocks, in six parts and one door.
 *
 * Client-safe: types and pure functions only, no `lib/db` import. The server
 * builds one `BkSheet` per request in `lib/blocks.ts`.
 *
 * THE VOCABULARY. the `law` direction established that a **block** is one email domain:
 * the natural cohort in this schema, the column `contacts_domain` is indexed
 * on, and the unit a company-name conflict is a deviation *within*. This
 * direction keeps that and adds one level above it. A **zone** is a lettered
 * region of the survey sheet holding roughly a dozen blocks — the same A/B/C/D
 * grid a real general-arrangement drawing carries down its border, so a block
 * can be referred to by where it sits as well as by what it is called.
 *
 * WHY ZONES BY MAGNITUDE. Blocks are already identified `BLK-01` upward by
 * descending record count, so contiguous slices of that order are size bands:
 * zone A holds the largest domains, D the smallest. That matters for reading
 * the sheet, because six deviations in a forty-record block and six in a
 * five-record block are not the same problem, and a grouping by defect KIND
 * would have made every dot in a zone red and thrown the per-block signal away.
 *
 * This file is the door. Everything importing `./model` keeps working, and the
 * six parts behind it can each be read in one sitting:
 *
 *   deviations  the four kinds, and the three states a record can be in
 *   rows        one contact, and one unadjudicated identity pair
 *   tables      one block
 *   zones       a quarter of the sheet, and the sheet itself
 *   flatten     the plane the cube becomes, and the camera looking at it
 *   vocabulary  finding things by id, and what a passing check says
 */
export * from "./model/deviations";
export * from "./model/rows";
export * from "./model/tables";
export * from "./model/zones";
export * from "./model/flatten";
export * from "./model/vocabulary";
