package home

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jiangmuran/vibepanel/internal/id"
)

var ErrNotFound = errors.New("home: project or task not found")
var ErrExists = errors.New("home: task already exists")

type StaleError struct{ Rev string }

func (e *StaleError) Error() string { return "stale" }

type CreateTask struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Stage     string   `json:"stage"`
	Status    string   `json:"status"`
	Primary   string   `json:"primary"`
	Secondary string   `json:"secondary"`
	DependsOn []string `json:"dependsOn"`
	Body      string   `json:"body"`
}

type PatchTask struct {
	Rev           string    `json:"rev"`
	Title         *string   `json:"title"`
	Stage         *string   `json:"stage"`
	Priority      *string   `json:"priority"`
	Tags          *[]string `json:"tags"`
	Owner         *string   `json:"owner"`
	Due           *string   `json:"due"`
	Primary       *string   `json:"primary"`
	Secondary     *string   `json:"secondary"`
	DependsOn     *[]string `json:"dependsOn"`
	Status        *string   `json:"status"`
	BlockedReason *string   `json:"blockedReason"`
	SessionStatus *string   `json:"sessionStatus"`
	Session       *string   `json:"session"`
}

func (i *Index) writableProject(cyxHome, project string) (*harnessFS, string, error) {
	if !projectID.MatchString(project) {
		return nil, "", ErrNotFound
	}
	_, f, err := i.open(cyxHome)
	if err != nil {
		return nil, "", err
	}
	base := filepath.Join("projects", project)
	// A directory alone is not a project; validate its manifest before creating
	// parents so a mistyped URL cannot manufacture a new Harness project.
	_, _, err = i.project(f, project, "")
	if err != nil {
		f.root.Close()
		return nil, "", ErrNotFound
	}
	return f, base, nil
}

func (f *harnessFS) mkdirs(name string) (string, error) {
	current := "."
	for _, part := range strings.Split(filepath.Clean(name), string(filepath.Separator)) {
		next := filepath.Join(current, part)
		if err := f.root.Mkdir(next, 0755); err != nil && !errors.Is(err, os.ErrExist) {
			return "", err
		}
		var err error
		current, err = f.resolve(next)
		if err != nil {
			return "", err
		}
		info, err := f.root.Stat(current)
		if err != nil {
			return "", err
		}
		if !info.IsDir() {
			return "", errors.New("task parent is not a directory")
		}
	}
	return current, nil
}

func (f *harnessFS) atomicWrite(name string, data []byte) error {
	if len(data) > MaxFileSize {
		return errors.New("task exceeds 256 KiB")
	}
	tmp := filepath.Join(filepath.Dir(name), ".task-"+id.New()+".tmp")
	file, err := f.root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer f.root.Remove(tmp)
	if _, err = file.Write(data); err == nil {
		err = file.Chmod(0644)
	}
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return f.root.Rename(tmp, name)
}

func (i *Index) Create(cyxHome, project string, req CreateTask) (Task, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	now := time.Now()
	if req.ID == "" {
		req.ID = "T-" + now.Format("20060102-150405")
	}
	if !taskID.MatchString(req.ID) {
		return Task{}, errors.New("invalid task id")
	}
	if strings.TrimSpace(req.Title) == "" {
		return Task{}, errors.New("title is required")
	}
	if req.Status == "" {
		req.Status = "planned"
	}
	if !ValidStatus(req.Status) {
		return Task{}, errors.New("invalid status")
	}
	if !validAssignment(req.Primary) || !validAssignment(req.Secondary) {
		return Task{}, errors.New("executor must be <harness>/<model>")
	}
	for _, dependency := range req.DependsOn {
		if !taskID.MatchString(dependency) {
			return Task{}, errors.New("invalid dependency id")
		}
	}
	var data strings.Builder
	data.WriteString("---\n")
	for _, field := range [][2]string{{"id", req.ID}, {"title", req.Title}, {"status", req.Status}, {"stage", req.Stage}, {"primary", req.Primary}, {"secondary", req.Secondary}} {
		fmt.Fprintf(&data, "%s: %s\n", field[0], encodeScalar(field[1]))
	}
	fmt.Fprintf(&data, "depends_on: [%s]\nsession:\nblocked_reason:\nsession_status: ok\nupdated: %s\n---\n%s", strings.Join(req.DependsOn, ", "), now.Format(time.RFC3339Nano), req.Body)
	if data.Len() > MaxFileSize {
		return Task{}, errors.New("task exceeds 256 KiB")
	}
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return Task{}, err
	}
	defer f.root.Close()
	parent, err := f.mkdirs(filepath.Join(base, "agent-docs", "tasks"))
	if err != nil {
		return Task{}, err
	}
	dir := filepath.Join(parent, req.ID)
	// Reserving the directory is exclusive across concurrent creators too.
	if err := f.root.Mkdir(dir, 0755); err != nil {
		if errors.Is(err, os.ErrExist) {
			return Task{}, ErrExists
		}
		return Task{}, err
	}
	if err = f.atomicWrite(filepath.Join(dir, "task.md"), []byte(data.String())); err != nil {
		_ = f.root.Remove(dir)
		return Task{}, err
	}
	task, _, err := parseTask([]byte(data.String()), req.ID, filepath.ToSlash(filepath.Join("agent-docs", "tasks", req.ID, "task.md")), now)
	return task, err
}

func encodeScalar(value string) string {
	if value == "" {
		return ""
	}
	if strings.TrimSpace(value) != value || strings.ContainsAny(value, "\r\n#\"'\\") {
		return strconv.Quote(value)
	}
	return value
}

func rewrite(f frontmatter, values map[string]string) []byte {
	var out bytes.Buffer
	out.Write(f.lines[0])
	for _, line := range f.lines[1:f.end] {
		key, _, _ := strings.Cut(string(line), ":")
		key = strings.TrimSpace(key)
		if value, ok := values[key]; ok {
			out.WriteString(key + ": " + encodeField(key, value) + f.newline)
			delete(values, key)
		} else {
			out.Write(line)
		}
	}
	keys := []string{}
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		out.WriteString(key + ": " + encodeField(key, values[key]) + f.newline)
	}
	out.Write(f.lines[f.end])
	out.Write(f.body)
	return out.Bytes()
}

func (i *Index) Patch(cyxHome, project, task string, req PatchTask) (Task, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !taskID.MatchString(task) {
		return Task{}, ErrNotFound
	}
	if err := validateTaskPatch(req); err != nil {
		return Task{}, err
	}
	if req.Status != nil && !ValidStatus(*req.Status) {
		return Task{}, errors.New("invalid status")
	}
	if req.SessionStatus != nil && *req.SessionStatus != "ok" && *req.SessionStatus != "rollover_due" {
		return Task{}, errors.New("invalid sessionStatus")
	}
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return Task{}, err
	}
	defer f.root.Close()
	file := filepath.Join("agent-docs", "tasks", task, "task.md")
	rel, err := f.resolve(filepath.Join(base, file))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			err = ErrNotFound
		}
		return Task{}, err
	}
	// Patches bypass the read cache: rev is a compare-and-swap on file bytes,
	// even when an external editor preserved both size and mtime.
	i.evict(filepath.Join(f.path, rel))
	data, at, err := i.file(f, filepath.Join(base, file))
	if err != nil {
		return Task{}, err
	}
	if Revision(data) != req.Rev {
		return Task{}, &StaleError{Rev: Revision(data)}
	}
	original, _, err := parseTask(data, task, filepath.ToSlash(file), at)
	if err != nil {
		return Task{}, err
	}
	fm, err := parseFrontmatter(data)
	if err != nil {
		return Task{}, err
	}
	values := map[string]string{"updated": time.Now().Format(time.RFC3339Nano)}
	for key, value := range map[string]*string{"status": req.Status, "blocked_reason": req.BlockedReason, "session_status": req.SessionStatus, "session": req.Session, "title": req.Title, "stage": req.Stage, "priority": req.Priority, "owner": req.Owner, "due": req.Due, "primary": req.Primary, "secondary": req.Secondary} {
		if value != nil {
			values[key] = *value
		}
	}
	for key, value := range map[string]*[]string{"tags": req.Tags, "depends_on": req.DependsOn} {
		if value != nil {
			values[key] = encodeList(*value)
		}
	}
	data = rewrite(fm, values)
	if err = f.atomicWrite(rel, data); err != nil {
		return Task{}, err
	}
	i.evict(filepath.Join(f.path, rel))
	updated, _, err := parseTask(data, task, filepath.ToSlash(file), time.Now())
	updated.Handoffs = original.Handoffs
	if entries, e := f.entries(filepath.Dir(filepath.Join(base, file))); e == nil {
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), "handoff-") && strings.HasSuffix(entry.Name(), ".md") {
				if info, _, err := f.stat(filepath.Join(base, filepath.Dir(file), entry.Name())); err == nil && info.Mode().IsRegular() {
					updated.Handoffs++
				}
			}
		}
	}
	return updated, err
}
