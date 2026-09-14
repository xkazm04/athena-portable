import { Atlas } from "@/components/atlas/Atlas";

/*
 * One route, three depths. There is no server work to do — the model is a TypeScript module
 * under `data/`, compiled into the bundle — so this page is static and the whole app is one
 * client component below it.
 */
export default function AtlasPage() {
  return <Atlas />;
}
