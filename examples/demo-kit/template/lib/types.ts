/** Row shapes shared between server queries and client components. No server imports here. */
export interface Record_ {
  id: string;
  title: string;
  status: "open" | "archived";
  owner: string;
  updated_at: string;
  note: string;
}
