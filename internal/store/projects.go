package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jiangmuran/vibepanel/internal/session"
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("store: not found")

// Project is a named directory that groups sessions.
type Project struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Path         string `json:"path"`
	SortIndex    *int   `json:"sortIndex"` // nil means "order me by activity"
	Pinned       bool   `json:"pinned"`
	LastActiveAt int64  `json:"lastActiveAt"`
	CreatedAt    int64  `json:"createdAt"`
	// ArchivedAt is when the project was hidden; nil for every project in the
	// sidebar. Its sessions are untouched by archiving -- see v31.
	ArchivedAt *int64 `json:"archivedAt"`
	// ArchivedAuto is true when the idle rule archived it rather than a person.
	ArchivedAuto bool `json:"archivedAuto"`
}

const projectColumns = `id, name, path, sort_index, pinned, last_active_at, created_at, archived_at, archived_auto`

func scanProject(sc scanner) (Project, error) {
	var p Project
	var sortIdx, archived sql.NullInt64
	if err := sc.Scan(&p.ID, &p.Name, &p.Path, &sortIdx, &p.Pinned, &p.LastActiveAt, &p.CreatedAt,
		&archived, &p.ArchivedAuto); err != nil {
		return Project{}, err
	}
	if sortIdx.Valid {
		v := int(sortIdx.Int64)
		p.SortIndex = &v
	}
	if archived.Valid {
		p.ArchivedAt = &archived.Int64
	}
	return p, nil
}

func (d *DB) queryProjects(ctx context.Context, query string, args ...any) ([]Project, error) {
	rows, err := d.sql.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list projects: %w", err)
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, fmt.Errorf("store: scan project: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateProject inserts a project and its empty note row.
func (d *DB) CreateProject(ctx context.Context, id, name, path string) (Project, error) {
	// Bounded like a session title, and for the same reason: a project name is
	// in the state snapshot, which is broadcast to every viewer. A session
	// title is whatever an agent printed; this one is typed, so the way it goes
	// wrong is a paste into the rename field rather than an escape sequence —
	// and the cost, on every phone watching, is the same.
	name = session.TruncateTitle(name)
	p := Project{ID: id, Name: name, Path: path, CreatedAt: now(), LastActiveAt: now()}

	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, fmt.Errorf("store: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once Commit succeeded

	_, err = tx.ExecContext(ctx,
		`INSERT INTO projects (id, name, path, last_active_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Path, p.LastActiveAt, p.CreatedAt)
	if err != nil {
		return Project{}, fmt.Errorf("store: insert project: %w", err)
	}
	// Create the note row up front so the notes panel never has to distinguish
	// "no note yet" from "project missing".
	_, err = tx.ExecContext(ctx,
		`INSERT INTO notes (project_id, content_md, updated_at) VALUES (?, '', ?)`, p.ID, now())
	if err != nil {
		return Project{}, fmt.Errorf("store: insert note row: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Project{}, fmt.Errorf("store: commit: %w", err)
	}
	return p, nil
}

// ListProjects returns the projects in the sidebar, in display order: pinned
// first, then manually positioned rows, then the rest by most recent activity.
// Archived projects are not in it; ListArchivedProjects has them.
//
// Excluding them here rather than in each caller is the point: this is what
// the snapshot, the chat bridge, share walls and the API token scopes all
// read, and "archived means hidden" should not depend on every one of them
// remembering a filter. The callers that must still see everything -- usage
// history, naming a share link's scope in settings -- ask ListAllProjects.
//
// The ordering lives in SQL rather than in Go so that every caller — REST,
// WebSocket snapshot, tests — sees the same sequence. Two implementations of
// "the sidebar order" would drift.
func (d *DB) ListProjects(ctx context.Context) ([]Project, error) {
	manual, err := d.ProjectOrderIsManual(ctx)
	if err != nil {
		return nil, err
	}
	// Two orderings, one query, chosen by a flag rather than by whether the
	// positions happen to be null — because the positions have to survive a
	// spell of automatic ordering. See ProjectOrderIsManual.
	return d.queryProjects(ctx, `
		SELECT `+projectColumns+`
		FROM projects
		WHERE archived_at IS NULL
		ORDER BY pinned DESC,
		         CASE WHEN ? AND sort_index IS NOT NULL THEN 0 ELSE 1 END,
		         CASE WHEN ? THEN sort_index END ASC,
		         last_active_at DESC,
		         created_at DESC`, manual, manual)
}

// ListArchivedProjects returns the archived projects, most recently archived
// first: the one somebody is looking for is usually the one that just went.
func (d *DB) ListArchivedProjects(ctx context.Context) ([]Project, error) {
	return d.queryProjects(ctx, `
		SELECT `+projectColumns+`
		FROM projects
		WHERE archived_at IS NOT NULL
		ORDER BY archived_at DESC, created_at DESC`)
}

// ListAllProjects returns every project, archived or not, in no particular
// order. For callers naming things that outlive the sidebar, such as usage
// history.
func (d *DB) ListAllProjects(ctx context.Context) ([]Project, error) {
	return d.queryProjects(ctx, `SELECT `+projectColumns+` FROM projects ORDER BY created_at`)
}

// GetProject returns one project, archived or not.
func (d *DB) GetProject(ctx context.Context, id string) (Project, error) {
	p, err := scanProject(d.sql.QueryRowContext(ctx,
		`SELECT `+projectColumns+` FROM projects WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, fmt.Errorf("store: get project: %w", err)
	}
	return p, nil
}

// ArchivedProjectAt returns the archived project whose directory is path, the
// most recently archived if there are several.
//
// This is what makes choosing an archived project's directory in the "new
// project" picker bring the old one back instead of adding a second row for
// the same tree, with none of the notes and todos the first one had.
func (d *DB) ArchivedProjectAt(ctx context.Context, path string) (Project, error) {
	p, err := scanProject(d.sql.QueryRowContext(ctx, `
		SELECT `+projectColumns+` FROM projects
		WHERE path = ? AND archived_at IS NOT NULL
		ORDER BY archived_at DESC LIMIT 1`, path))
	if err == sql.ErrNoRows {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, fmt.Errorf("store: archived project at path: %w", err)
	}
	return p, nil
}

// ArchiveProject hides a project. auto records that the idle rule did it.
//
// Only a project in the sidebar can be archived: archiving an archived one
// again would move its archived_at and turn a manual archive into an automatic
// one, which is the one fact the archived list exists to keep straight.
func (d *DB) ArchiveProject(ctx context.Context, id string, auto bool) error {
	res, err := d.sql.ExecContext(ctx,
		`UPDATE projects SET archived_at = ?, archived_auto = ? WHERE id = ? AND archived_at IS NULL`,
		now(), auto, id)
	if err != nil {
		return fmt.Errorf("store: archive project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if _, err := d.GetProject(ctx, id); err != nil {
			return err
		}
		return ErrAlreadyArchived
	}
	return nil
}

// ErrAlreadyArchived is ArchiveProject on a project that is already hidden.
var ErrAlreadyArchived = errors.New("store: project is already archived")

// RestoreProject puts an archived project back in the sidebar.
//
// It counts as activity, or the idle rule would archive it again within the
// hour: nothing else has touched it for as long as it has been away. Its
// manual position is dropped, because the positions went on being handed out
// while it was gone and one it came back holding may now belong to another
// project -- and two rows sharing a position trade places at random. It
// returns among the automatically ordered ones, which in automatic order is
// the top, since it has just been active.
//
// Restoring a project that is not archived is not an error: two tabs, or the
// picker and the list, can ask at once, and both got what they asked for.
func (d *DB) RestoreProject(ctx context.Context, id string) error {
	res, err := d.sql.ExecContext(ctx, `
		UPDATE projects SET archived_at = NULL, archived_auto = 0, sort_index = NULL,
		                    last_active_at = ?
		WHERE id = ? AND archived_at IS NOT NULL`, now(), id)
	if err != nil {
		return fmt.Errorf("store: restore project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		_, err := d.GetProject(ctx, id)
		return err
	}
	return nil
}

// idleSince is the idle rule's predicate over a row of projects aliased p,
// with ?1 the cutoff. One definition, used both to find the idle projects and
// again inside the UPDATE that archives one, so a project that came back to
// life between the two is not archived on the strength of the first look.
//
// "Touched" is everything the panel can see happen to a project, because the
// obvious column alone is wrong: last_active_at moves only when a session is
// created, so a project with one agent that has been working for three weeks
// would read as three weeks idle. A session printing anything, or changing
// state, is activity; so is editing the note, and adding or ticking a todo. A
// pinned project is never idle -- pinning it is somebody saying they want it
// in front of them.
const idleSince = `p.archived_at IS NULL
		  AND p.pinned = 0
		  AND p.last_active_at < ?1
		  AND p.created_at < ?1
		  AND NOT EXISTS (
		      SELECT 1 FROM sessions s
		      WHERE s.project_id = p.id
		        AND (s.last_output_at >= ?1 OR s.state_changed_at >= ?1 OR s.created_at >= ?1))
		  AND NOT EXISTS (
		      SELECT 1 FROM notes n WHERE n.project_id = p.id AND n.updated_at >= ?1)
		  AND NOT EXISTS (
		      SELECT 1 FROM todos t
		      WHERE t.project_id = p.id AND (t.created_at >= ?1 OR t.done_at >= ?1))`

// IdleProjects returns the projects in the sidebar that nothing has touched
// since cutoff: the ones the idle rule archives. See idleSince.
func (d *DB) IdleProjects(ctx context.Context, cutoff int64) ([]Project, error) {
	return d.queryProjects(ctx, `
		SELECT `+projectColumns+` FROM projects p
		WHERE `+idleSince+`
		ORDER BY p.created_at`, cutoff)
}

// ArchiveIfIdle archives a project for the idle rule, only if it is still
// idle since cutoff at the moment of the write, and reports whether it did.
// Between IdleProjects and here a session can start printing or somebody can
// open the project; the list was a candidate list, not a verdict.
func (d *DB) ArchiveIfIdle(ctx context.Context, id string, cutoff int64) (bool, error) {
	res, err := d.sql.ExecContext(ctx, `
		UPDATE projects AS p SET archived_at = ?2, archived_auto = 1
		WHERE p.id = ?3 AND `+idleSince, cutoff, now(), id)
	if err != nil {
		return false, fmt.Errorf("store: archive idle project: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// RenameProject changes a project's display name.
func (d *DB) RenameProject(ctx context.Context, id, name string) error {
	return d.exec1(ctx, `UPDATE projects SET name = ? WHERE id = ?`, session.TruncateTitle(name), id)
}

// SetProjectPinned pins or unpins a project.
func (d *DB) SetProjectPinned(ctx context.Context, id string, pinned bool) error {
	return d.exec1(ctx, `UPDATE projects SET pinned = ? WHERE id = ?`, pinned, id)
}

// SetProjectSortIndex sets a manual position, or clears it with nil to return
// the project to automatic activity ordering.
func (d *DB) SetProjectSortIndex(ctx context.Context, id string, idx *int) error {
	if idx == nil {
		return d.exec1(ctx, `UPDATE projects SET sort_index = NULL WHERE id = ?`, id)
	}
	return d.exec1(ctx, `UPDATE projects SET sort_index = ? WHERE id = ?`, *idx, id)
}

// ReorderProjects writes an explicit order, replacing automatic ordering.
//
// Takes the whole list rather than one project's new position: a drag changes
// where every project below it sits, and sending those one at a time leaves the
// sidebar briefly showing an order that never existed if any request fails.
//
// Ids not present in the list return to automatic ordering, inside this
// transaction. Leaving them exactly as they were is not the same as leaving
// them alone: a project that already carried an explicit position keeps it,
// and two projects sharing an index swap places whenever one of them is
// active, so manual order silently stops being manual. The list arrives from
// a viewer looking at the whole sidebar, so an id it omitted is a project the
// viewer did not see, and "everything I did not drag goes back to automatic"
// is the order the drag describes.
//
// Reachable only from a stale list: two viewers, one reordering while the
// other's idea of the project set is out of date. This used to be left undone
// on the grounds that demoting a project somebody else can see is a decision
// about their sidebar -- but the panel has one user, and the silent reordering
// was worse than an explicit demotion.
func (d *DB) ReorderProjects(ctx context.Context, ids []string) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin reorder: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once Commit succeeded

	for i, id := range ids {
		res, err := tx.ExecContext(ctx, `UPDATE projects SET sort_index = ? WHERE id = ?`, i, id)
		if err != nil {
			return fmt.Errorf("store: reorder project %s: %w", id, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return fmt.Errorf("store: reorder rows: %w", err)
		}
		if n == 0 {
			return fmt.Errorf("store: reorder: %w: project %s", ErrNotFound, id)
		}
	}

	// Everything the list omitted goes back to automatic ordering, after the
	// listed ids rather than tangled among them.
	if len(ids) > 0 {
		placeholders := strings.Repeat("?,", len(ids))
		placeholders = placeholders[:len(placeholders)-1]
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE projects SET sort_index = NULL WHERE id NOT IN (`+placeholders+`)`, args...); err != nil {
			return fmt.Errorf("store: reorder omitted: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit reorder: %w", err)
	}
	// Arranging them by hand is what chooses the manual ordering. Inferring it
	// from the positions is what made the two inseparable.
	return d.SetProjectOrderManual(ctx, true)
}

// projectOrderKey records which of the two orderings the sidebar is using.
//
// Separate from the positions themselves, which is the whole point. It used to
// be inferred — "manual" meant at least one project carried a sort_index — so
// the only way to go back to automatic was to erase every position. A clock
// icon, no confirmation, and an arrangement somebody sat down and made was
// gone; the button then disappeared, because it only renders in manual mode,
// so there was not even anything left to click.
//
// Measured: four projects arranged `delta bravo alpha charlie`, one click,
// back to `alpha bravo charlie delta` and unrecoverable.
const projectOrderKey = "projects.order"

// SetProjectOrderManual chooses between the two orderings without touching the
// positions, so that going back to automatic and changing your mind is free.
func (d *DB) SetProjectOrderManual(ctx context.Context, manual bool) error {
	mode := "auto"
	if manual {
		mode = "manual"
	}
	return d.SetSetting(ctx, projectOrderKey, mode)
}

// HasProjectOrder reports whether an arrangement is stored at all, whichever
// ordering is in use. The UI needs it to offer "back to my order" while the
// automatic one is showing.
func (d *DB) HasProjectOrder(ctx context.Context) (bool, error) {
	var n int
	err := d.sql.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM projects WHERE sort_index IS NOT NULL`).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("store: stored project order: %w", err)
	}
	return n > 0, nil
}

// ProjectOrderIsManual reports which ordering the sidebar is using.
func (d *DB) ProjectOrderIsManual(ctx context.Context) (bool, error) {
	mode, err := d.GetSetting(ctx, projectOrderKey, "")
	if err != nil {
		return false, fmt.Errorf("store: project order mode: %w", err)
	}
	if mode != "" {
		return mode == "manual", nil
	}
	// Nothing recorded: a database from before the mode was stored separately,
	// where carrying a position *was* the mode.
	var n int
	err = d.sql.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM projects WHERE sort_index IS NOT NULL`).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("store: project order mode: %w", err)
	}
	return n > 0, nil
}

// TouchProject records activity, which drives automatic ordering.
func (d *DB) TouchProject(ctx context.Context, id string) error {
	_, err := d.sql.ExecContext(ctx, `UPDATE projects SET last_active_at = ? WHERE id = ?`, now(), id)
	if err != nil {
		return fmt.Errorf("store: touch project: %w", err)
	}
	return nil
}

// DeleteProject removes a project. Sessions, notes and todos cascade.
//
// It does not touch tmux: killing the underlying sessions is the caller's job,
// because a database transaction cannot be rolled back once a process is dead.
func (d *DB) DeleteProject(ctx context.Context, id string) error {
	return d.exec1(ctx, `DELETE FROM projects WHERE id = ?`, id)
}

// exec1 runs a statement that must affect exactly one row.
func (d *DB) exec1(ctx context.Context, query string, args ...any) error {
	res, err := d.sql.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("store: exec: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
