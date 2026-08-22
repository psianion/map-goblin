// D8 — the module's single entry point: importing it registers the Tokens panel (which
// renders the Library tab itself in M3; TokenLibraryPanel no longer registers on its own)
// and mounts the Pixi overlay. GameTable imports this and learns nothing else — `TokenMenu`
// is the one exception, mounted directly by GameTable as an on-map overlay rather than a
// registered panel.
import './TokenPanel';
