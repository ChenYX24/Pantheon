package home

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type cacheEntry struct {
	mtime time.Time
	size  int64
	data  []byte
}

type Index struct {
	mu        sync.Mutex
	cache     map[string]cacheEntry
	cacheSize int
}

func (i *Index) evict(path string) {
	i.cacheSize -= len(i.cache[path].data)
	delete(i.cache, path)
}

type registry struct {
	Version int               `json:"version"`
	Paths   map[string]string `json:"paths"`
}

type harnessFS struct {
	path string
	root *os.Root
}

func (i *Index) open(cyxHome string) (registry, *harnessFS, error) {
	var local registry
	path := filepath.Join(cyxHome, "local.json")
	info, err := os.Stat(path)
	if err != nil {
		return local, nil, fmt.Errorf("local.json: %w", err)
	}
	raw, err := i.read(path, info, func() (*os.File, error) { return os.Open(path) })
	if err != nil {
		return local, nil, err
	}
	if err = json.Unmarshal(raw, &local); err != nil {
		return local, nil, fmt.Errorf("local.json: %w", err)
	}
	if local.Version != 1 {
		return local, nil, errors.New("unsupported local.json version")
	}
	root := local.Paths["cyx-agent-harness"]
	if root == "" {
		return local, nil, errors.New("local.json has no cyx-agent-harness path")
	}
	if !filepath.IsAbs(root) {
		return local, nil, errors.New("Harness path must be absolute")
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return local, nil, fmt.Errorf("Harness: %w", err)
	}
	f, err := os.OpenRoot(root)
	if err != nil {
		return local, nil, fmt.Errorf("Harness: %w", err)
	}
	return local, &harnessFS{path: root, root: f}, nil
}

// Resolve absolute links inside the Harness too, then let os.Root enforce the
// boundary during the actual operation, including a concurrent symlink swap.
func (f *harnessFS) resolve(name string) (string, error) {
	path, err := filepath.EvalSymlinks(filepath.Join(f.path, name))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(f.path, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("symlink escapes Harness root")
	}
	return rel, nil
}

func (f *harnessFS) stat(name string) (os.FileInfo, string, error) {
	rel, err := f.resolve(name)
	if err != nil {
		return nil, "", err
	}
	info, err := f.root.Stat(rel)
	return info, rel, err
}

func (f *harnessFS) entries(name string) ([]os.DirEntry, error) {
	rel, err := f.resolve(name)
	if err != nil {
		return nil, err
	}
	dir, err := f.root.Open(rel)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	entries, err := dir.ReadDir(-1)
	sort.Slice(entries, func(a, b int) bool { return entries[a].Name() < entries[b].Name() })
	return entries, err
}

func (i *Index) read(path string, info os.FileInfo, open func() (*os.File, error)) ([]byte, error) {
	if !info.Mode().IsRegular() {
		return nil, errors.New("not a regular file")
	}
	if info.Size() > MaxFileSize {
		return nil, errors.New("file exceeds 256 KiB")
	}
	if cached, ok := i.cache[path]; ok && cached.mtime.Equal(info.ModTime()) && cached.size == info.Size() {
		return cached.data, nil
	}
	f, err := open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxFileSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxFileSize {
		return nil, errors.New("file exceeds 256 KiB")
	}
	// The cache is an optimization, not another unbounded copy of the Harness.
	if i.cache == nil || i.cacheSize+len(data) > 16<<20 {
		i.cache = map[string]cacheEntry{}
		i.cacheSize = 0
	}
	i.cacheSize -= len(i.cache[path].data)
	i.cache[path] = cacheEntry{info.ModTime(), info.Size(), data}
	i.cacheSize += len(data)
	return data, nil
}

func (i *Index) file(f *harnessFS, name string) ([]byte, time.Time, error) {
	info, rel, err := f.stat(name)
	if err != nil {
		return nil, time.Time{}, err
	}
	data, err := i.read(filepath.Join(f.path, rel), info, func() (*os.File, error) { return f.root.Open(rel) })
	return data, info.ModTime(), err
}

func (i *Index) Snapshot(cyxHome string, all bool, runtime []RuntimeProject) Snapshot {
	i.mu.Lock()
	defer i.mu.Unlock()
	out := Snapshot{GeneratedAt: time.Now().Format(time.RFC3339Nano), Projects: []Project{}, Todos: []Todo{}, Warnings: []Warning{}, Details: map[string]Detail{}}
	local, f, err := i.open(cyxHome)
	if err != nil {
		out.Reason = err.Error()
		if !errors.Is(err, os.ErrNotExist) {
			out.Warnings = append(out.Warnings, Warning{File: "local.json", Message: err.Error()})
		}
		return out
	}
	defer f.root.Close()
	out.Available = true
	entries, err := f.entries("projects")
	if err != nil {
		out.Warnings = append(out.Warnings, Warning{File: "projects", Message: err.Error()})
		return out
	}
	for _, entry := range entries {
		id := entry.Name()
		if !projectID.MatchString(id) {
			continue
		}
		base := filepath.Join("projects", id)
		info, _, err := f.stat(base)
		if err != nil {
			out.Warnings = append(out.Warnings, Warning{id, "project.json", err.Error()})
			continue
		}
		if !info.IsDir() {
			continue
		}
		d, warnings, err := i.project(f, id, local.Paths[id])
		out.Warnings = append(out.Warnings, warnings...)
		if err != nil {
			continue
		}
		if !all && (d.Project.Status == "archived" || d.Project.Status == "merged") {
			continue
		}
		for _, panel := range runtime {
			if SamePath(d.Project.Path, panel.Path) {
				if d.Project.PanelProjectID == nil {
					pid := panel.ID
					d.Project.PanelProjectID = &pid
				}
				d.Project.Sessions = append(d.Project.Sessions, panel.Sessions...)
			}
		}
		sort.Slice(d.Project.Sessions, func(a, b int) bool { return d.Project.Sessions[a].ID < d.Project.Sessions[b].ID })
		d.Todos = deriveTodos(d)
		out.Details[id] = d
		out.Projects = append(out.Projects, d.Project)
		out.Todos = append(out.Todos, d.Todos...)
	}
	SortTodos(out.Todos)
	sort.Slice(out.Projects, func(a, b int) bool {
		x, y := out.Projects[a], out.Projects[b]
		xTodo, yTodo := len(out.Details[x.ID].Todos) > 0, len(out.Details[y.ID].Todos) > 0
		if xTodo != yTodo {
			return xTodo
		}
		if x.UpdatedAt != y.UpdatedAt {
			return timestamp(x.UpdatedAt).After(timestamp(y.UpdatedAt))
		}
		return x.ID < y.ID
	})
	return out
}

func (i *Index) project(f *harnessFS, id, checkout string) (Detail, []Warning, error) {
	d := Detail{Tasks: []Task{}, Reports: []Report{}, Todos: []Todo{}, Directory: filepath.Join(f.path, "projects", id)}
	warnings := []Warning{}
	warn := func(file string, err error) {
		warnings = append(warnings, Warning{id, filepath.ToSlash(file), err.Error()})
	}
	base := filepath.Join("projects", id)
	data, newest, err := i.file(f, filepath.Join(base, "project.json"))
	if err != nil {
		warn("project.json", err)
		return d, warnings, err
	}
	var manifest struct {
		ID         string          `json:"id"`
		Aliases    []string        `json:"aliases"`
		Portfolio  string          `json:"portfolio"`
		Category   string          `json:"category"`
		Status     string          `json:"status"`
		StateMode  string          `json:"state_mode"`
		Sync       json.RawMessage `json:"sync"`
		Repo       string          `json:"repo"`
		Parent     string          `json:"parent"`
		MergedInto string          `json:"merged_into"`
	}
	if err = json.Unmarshal(data, &manifest); err != nil {
		warn("project.json", err)
		return d, warnings, err
	}
	if manifest.ID != id {
		err = errors.New("project id must match its directory")
		warn("project.json", err)
		return d, warnings, err
	}
	p := Project{ID: id, Aliases: manifest.Aliases, Portfolio: manifest.Portfolio, Category: manifest.Category, Status: manifest.Status, StateMode: manifest.StateMode, Sync: manifest.Sync, Repo: manifest.Repo, Parent: manifest.Parent, MergedInto: manifest.MergedInto, Path: checkout, ActiveDocs: []Link{}, Blockers: []string{}, TaskCounts: map[string]int{"total": 0}, Stages: []Stage{}, Sessions: []Session{}}
	if p.Aliases == nil {
		p.Aliases = []string{}
	}
	if checkout != "" {
		if !filepath.IsAbs(checkout) {
			warn("local.json", errors.New("checkout path must be absolute"))
			p.Path = ""
		} else if info, err := os.Stat(checkout); err == nil {
			p.PathExists = info.IsDir()
		}
	}
	touch := func(at time.Time) {
		if at.After(newest) {
			newest = at
		}
	}
	if data, at, err := i.file(f, filepath.Join(base, "ACTIVE_CONTEXT.md")); err == nil {
		touch(at)
		active := ParseActiveContext(data)
		p.Goal, p.ActiveDocs, p.LastVerified, p.Blockers = active.Goal, active.ActiveDocs, active.LastVerified, active.Blockers
		d.ActiveContext, d.activeRev, d.activeAt = string(data), Revision(data), at.Format(time.RFC3339Nano)
	} else if !errors.Is(err, os.ErrNotExist) {
		warn("ACTIVE_CONTEXT.md", err)
	}
	for _, status := range Statuses {
		p.TaskCounts[status] = 0
	}
	taskDir := filepath.Join("agent-docs", "tasks")
	entries, err := f.entries(filepath.Join(base, taskDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		warn(taskDir, err)
	}
	count := 0
	for _, entry := range entries {
		if !taskID.MatchString(entry.Name()) {
			continue
		}
		if count == 500 {
			warn(taskDir, errors.New("task limit is 500; remaining tasks skipped"))
			break
		}
		file := filepath.Join(taskDir, entry.Name(), "task.md")
		data, at, err := i.file(f, filepath.Join(base, file))
		if err != nil {
			warn(file, err)
			continue
		}
		count++
		touch(at)
		t, notes, err := parseTask(data, entry.Name(), filepath.ToSlash(file), at)
		for _, note := range notes {
			warn(file, errors.New(note))
		}
		if err != nil {
			warn(file, err)
			continue
		}
		handoffs, err := f.entries(filepath.Join(base, taskDir, entry.Name()))
		if err != nil {
			warn(file, err)
		}
		for _, handoff := range handoffs {
			if !strings.HasPrefix(handoff.Name(), "handoff-") || !strings.HasSuffix(handoff.Name(), ".md") {
				continue
			}
			name := filepath.Join(taskDir, entry.Name(), handoff.Name())
			info, _, err := f.stat(filepath.Join(base, name))
			if err != nil {
				warn(name, err)
				continue
			}
			if info.Mode().IsRegular() {
				t.Handoffs++
				touch(info.ModTime())
			}
		}
		d.Tasks = append(d.Tasks, t)
		p.TaskCounts[t.Status]++
		p.TaskCounts["total"]++
	}
	stages := map[string]Stage{}
	for _, task := range d.Tasks {
		stage := stages[task.Stage]
		stage.Name = task.Stage
		stage.Total++
		if task.Status == "done" {
			stage.Done++
		}
		stages[task.Stage] = stage
	}
	for _, stage := range stages {
		p.Stages = append(p.Stages, stage)
	}
	sort.Slice(p.Stages, func(a, b int) bool { return p.Stages[a].Name < p.Stages[b].Name })
	reportDir := filepath.Join("agent-docs", "reports")
	entries, err = f.entries(filepath.Join(base, reportDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		warn(reportDir, err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		file := filepath.Join(reportDir, entry.Name())
		data, at, err := i.file(f, filepath.Join(base, file))
		if err != nil {
			warn(file, err)
			continue
		}
		touch(at)
		report, notes, err := parseReport(data, entry.Name(), at)
		for _, note := range notes {
			warn(file, errors.New(note))
		}
		if err != nil {
			warn(file, err)
			continue
		}
		d.Reports = append(d.Reports, report)
		sort.Slice(d.Reports, func(a, b int) bool {
			if !d.Reports[a].at.Equal(d.Reports[b].at) {
				return d.Reports[a].at.After(d.Reports[b].at)
			}
			return d.Reports[a].File < d.Reports[b].File
		})
		if len(d.Reports) > 50 {
			d.Reports = d.Reports[:50]
		}
	}
	if len(d.Reports) > 0 {
		latest := d.Reports[0].ReportSummary
		p.LatestReport = &latest
	}
	p.UpdatedAt = newest.Format(time.RFC3339Nano)
	d.Project = p
	return d, warnings, nil
}

func SamePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	clean := func(path string) string {
		path = filepath.Clean(path)
		if resolved, err := filepath.EvalSymlinks(path); err == nil {
			return resolved
		}
		return path
	}
	return clean(a) == clean(b)
}

func timestamp(value string) time.Time { at, _ := time.Parse(time.RFC3339Nano, value); return at }

func deriveTodos(d Detail) []Todo {
	out := []Todo{}
	add := func(kind, source, rev, title, detail, at string, link TodoLink) {
		link.ProjectID = d.Project.ID
		out = append(out, Todo{Revision([]byte(kind + "|" + d.Project.ID + "|" + source + "|" + rev)), kind, d.Project.ID, title, detail, at, link})
	}
	if len(d.Project.Blockers) > 0 {
		add("blocked", "", d.activeRev, d.Project.ID, strings.Join(d.Project.Blockers, "\n"), d.activeAt, TodoLink{})
	}
	for _, t := range d.Tasks {
		at := t.Updated
		if timestamp(at).IsZero() {
			at = t.mtime.Format(time.RFC3339Nano)
		}
		link := TodoLink{TaskID: t.ID}
		switch t.Status {
		case "awaiting_review", "awaiting_approval", "blocked":
			add(t.Status, t.ID, t.Rev, t.Title, t.BlockedReason, at, link)
		}
		if t.SessionStatus == "rollover_due" {
			link.SessionID = t.Session
			add("session_rollover", t.ID, t.Rev, t.Title, t.BlockedReason, at, link)
		}
	}
	for _, report := range d.Reports {
		if report.NeedsUser {
			add("question", report.File, report.rev, report.Title, report.Summary, report.At, TodoLink{ReportFile: report.File})
		}
	}
	for _, s := range d.Project.Sessions {
		if s.State == "waiting" {
			add("session_waiting", s.ID, s.StateChangedAt, s.Name, "", s.StateChangedAt, TodoLink{SessionID: s.ID})
		}
	}
	SortTodos(out)
	return out
}

func SortTodos(todos []Todo) {
	order := map[string]int{"question": 0, "awaiting_approval": 1, "blocked": 2, "awaiting_review": 3, "session_waiting": 4, "session_rollover": 5}
	sort.Slice(todos, func(a, b int) bool {
		x, y := todos[a], todos[b]
		if order[x.Kind] != order[y.Kind] {
			return order[x.Kind] < order[y.Kind]
		}
		if !timestamp(x.At).Equal(timestamp(y.At)) {
			return timestamp(x.At).After(timestamp(y.At))
		}
		return x.ID < y.ID
	})
}
