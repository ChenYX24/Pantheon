package home

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// EligibleTasks is shared by immediate execution and the scheduler. Capacity
// and the Git checkout are checked by the server before it reserves a run.
func EligibleTasks(d Detail, manual bool) []Task {
	out := []Task{}
	if d.Project.Meta.ValidateExecution() != nil {
		return out
	}
	status := map[string]string{}
	for _, task := range d.Tasks {
		status[task.ID] = task.Status
	}
	for _, task := range d.Tasks {
		approved := manual || d.Project.Meta.Autonomy == "full"
		if d.Project.Meta.Autonomy == "stage" {
			for _, stage := range d.Project.Meta.ApprovedStages {
				approved = approved || stage == task.Stage
			}
		}
		if !approved || task.Status != "planned" {
			continue
		}
		ready := true
		for _, dependency := range task.DependsOn {
			ready = ready && status[dependency] == "done"
		}
		if ready {
			out = append(out, task)
		}
	}
	sort.Slice(out, func(a, b int) bool {
		return TaskBefore(out[a], out[b])
	})
	return out
}

func TaskBefore(x, y Task) bool {
	if priority(x.Priority) != priority(y.Priority) {
		return priority(x.Priority) < priority(y.Priority)
	}
	if !timestamp(x.Updated).Equal(timestamp(y.Updated)) {
		return timestamp(x.Updated).Before(timestamp(y.Updated))
	}
	return x.ID < y.ID
}

func priority(value string) int {
	if strings.HasPrefix(value, "P") {
		if n, err := strconv.Atoi(value[1:]); err == nil && n >= 0 && n < 1000000 {
			return n
		}
	}
	return 1000000
}

func receiptMarker(key string) string { return "<!-- pantheon-receipt: " + key + " -->" }

func (i *Index) Handoff(cyxHome, project, task, run string) (string, string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !taskID.MatchString(task) {
		return "", "", ErrNotFound
	}
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return "", "", err
	}
	defer f.root.Close()
	return i.handoff(f, filepath.Join(base, "agent-docs", "tasks", task), run)
}

func (i *Index) handoff(f *harnessFS, dir, run string) (string, string, error) {
	entries, err := f.entries(dir)
	if err != nil {
		return "", "", err
	}
	latest, content, max := "", "", 0
	for _, entry := range entries {
		n, ok := handoffNumber(entry.Name())
		if !ok {
			continue
		}
		data, _, err := i.file(f, filepath.Join(dir, entry.Name()))
		if err != nil {
			return "", "", err
		}
		if run != "" && strings.Contains(string(data), receiptMarker(run)) {
			return entry.Name(), string(data), nil
		}
		if run == "" && n > max {
			latest, content, max = entry.Name(), string(data), n
		}
	}
	return latest, capBytes(content, 16<<10), nil
}

func handoffNumber(name string) (int, bool) {
	if !strings.HasPrefix(name, "handoff-") || !strings.HasSuffix(name, ".md") {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(name, "handoff-"), ".md"))
	return n, err == nil && n > 0
}

func (i *Index) AppendHandoff(cyxHome, project, task, run, body string) (string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !taskID.MatchString(task) || !taskID.MatchString(run) {
		return "", ErrNotFound
	}
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return "", err
	}
	defer f.root.Close()
	dir := filepath.Join(base, "agent-docs", "tasks", task)
	if _, _, err = i.file(f, filepath.Join(dir, "task.md")); err != nil {
		return "", err
	}
	if file, _, err := i.handoff(f, dir, run); err != nil || file != "" {
		return file, err
	}
	entries, err := f.entries(dir)
	if err != nil {
		return "", err
	}
	next := 1
	for _, entry := range entries {
		if n, ok := handoffNumber(entry.Name()); ok && n >= next {
			next = n + 1
		}
	}
	parent, err := f.resolve(dir)
	if err != nil {
		return "", err
	}
	name := fmt.Sprintf("handoff-%03d.md", next)
	return name, f.atomicWrite(filepath.Join(parent, name), []byte(receiptMarker(run)+"\n\n"+body))
}

type ExecutionReport struct {
	Key, File, Title, Task, Summary, Body string
	At                                    time.Time
	NeedsUser                             bool
}

// The marker survives restarts between writing files and finishing the database
// row. A second run in the same minute gets a suffix instead of losing a report.
func (i *Index) WriteExecutionReport(cyxHome, project string, report ExecutionReport) (string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if filepath.Base(report.File) != report.File || strings.ContainsAny(report.File, "/\\") || !strings.HasSuffix(report.File, ".md") {
		return "", errors.New("invalid report file")
	}
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return "", err
	}
	defer f.root.Close()
	dir, err := f.mkdirs(filepath.Join(base, "agent-docs", "reports"))
	if err != nil {
		return "", err
	}
	name := report.File
	for n := 2; ; n++ {
		data, _, err := i.file(f, filepath.Join(dir, name))
		if errors.Is(err, os.ErrNotExist) {
			break
		}
		if err != nil {
			return "", err
		}
		if strings.Contains(string(data), receiptMarker(report.Key)) {
			return name, nil
		}
		name = strings.TrimSuffix(report.File, ".md") + fmt.Sprintf("-%d.md", n)
	}
	data := fmt.Sprintf("---\ntitle: %s\nat: %s\nkind: report\nneeds_user: %t\ntask: %s\nsummary: %s\n---\n%s\n\n%s\n",
		encodeScalar(report.Title), report.At.Format(time.RFC3339), report.NeedsUser, encodeScalar(report.Task), encodeScalar(report.Summary), receiptMarker(report.Key), report.Body)
	return name, f.atomicWrite(filepath.Join(dir, name), []byte(data))
}
