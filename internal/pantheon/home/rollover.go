package home

import (
	"errors"
	"path/filepath"
	"time"
)

// RolloverHandoff matches the panel's checkout exactly, just like the home
// overlay. A similarly named project must not receive another project's work.
func (i *Index) RolloverHandoff(cyxHome, checkout, sessionID string, at time.Time) (path, project string, err error) {
	if !taskID.MatchString(sessionID) {
		return "", "", errors.New("invalid session id")
	}
	snapshot := i.Snapshot(cyxHome, true, nil)
	for _, p := range snapshot.Projects {
		if SamePath(p.Path, checkout) {
			if project != "" {
				return "", "", errors.New("checkout matches multiple cyx projects")
			}
			project = p.ID
		}
	}
	if project == "" {
		return "", "", nil
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return "", "", err
	}
	defer f.root.Close()
	dir, err := f.mkdirs(filepath.Join(base, "agent-docs", "handoffs"))
	if err != nil {
		return "", "", err
	}
	return filepath.Join(f.path, dir, at.Format("2006-01-02-15-04")+"-"+sessionID+".md"), project, nil
}
