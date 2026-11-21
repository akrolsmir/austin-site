import type { ElementType } from "react";
import { getSite } from "./index";

/** Renders a text slot under the editor's markup contract: the element carries data-e and its text is exactly the slot value. */
export async function E({ id, as: Tag = "span", ...props }: { id: string; as?: ElementType; className?: string; [prop: string]: unknown }) {
  return <Tag {...props} data-e={id}>{(await getSite()).text(id)}</Tag>;
}
