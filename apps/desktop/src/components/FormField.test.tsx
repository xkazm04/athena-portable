/** FormField's action slot — README section 3.1, ADR 0087. */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import FormField, { TextInput } from "./FormField";

it("puts an action level with the control, above the hint, so no caller lines it up by hand", () => {
  const h = renderToStaticMarkup(
    <FormField label="Add" hint="A hint" action={<button>Add</button>}>
      {(input) => <TextInput {...input} />}
    </FormField>,
  );
  const row = h.indexOf('class="field__row"');
  expect(row).toBeGreaterThan(-1);
  expect(h.indexOf("<input")).toBeGreaterThan(row);
  expect(h.indexOf("<button")).toBeGreaterThan(h.indexOf("<input"));
  expect(h.indexOf("A hint")).toBeGreaterThan(h.indexOf("</button>"));
});

it("renders no row when there is no action", () => {
  const h = renderToStaticMarkup(<FormField label="Name">{(input) => <TextInput {...input} />}</FormField>);
  expect(h).not.toContain("field__row");
});
