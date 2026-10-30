import { CONTENT } from "../../content";
import { tag } from "./markup";

/** A type's name as players read it ("Fire", in Hungarian "Tűz"); the id is the fallback. */
export const typeName = (id: string): string => CONTENT.types[id]?.name ?? id;

/** A type's name in its own colour, for rich text. */
export const typeTag = (id: string): string => tag(id, typeName(id));
