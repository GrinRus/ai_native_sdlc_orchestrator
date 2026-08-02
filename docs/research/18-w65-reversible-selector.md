# W65 reversible selector and navigation evidence

The temporary dual-renderer package has one project/Flow snapshot, one live
update lifecycle, and one canonical action adapter. Presentation selection uses
query, app config, then compiled default; the current default remains legacy.

Quiet presentation state is encoded only in `mode`, `stage`, `attention`, and
`evidence` URL parameters. Browser history restores supported selections;
invalid values normalize to their labelled parent view. Neither URL state nor
renderer selection is persisted as runtime evidence or used for authorization.

The installed browser fixture switches legacy to Quiet Cockpit, changes mode,
reloads, switches back, and uses browser history while retaining the same
Project identity. Read errors remain visible in the selected presentation and
never cause an automatic fallback.
