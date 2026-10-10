package home

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type ProjectMeta struct {
	Labels   []string `json:"labels"`
	Priority string   `json:"priority"`
	Owner    string   `json:"owner"`
	Phase    string   `json:"phase"`
	Pinned   bool     `json:"pinned"`
}

type PatchMeta struct {
	Rev      string    `json:"rev"`
	Labels   *[]string `json:"labels"`
	Priority *string   `json:"priority"`
	Owner    *string   `json:"owner"`
	Phase    *string   `json:"phase"`
	Pinned   *bool     `json:"pinned"`
}

func (i *Index) PatchMeta(cyxHome, project string, req PatchMeta) (ProjectMeta, string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	meta := ProjectMeta{Labels: []string{}}
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return meta, "", err
	}
	defer f.root.Close()
	name := filepath.Join(base, "pantheon.json")
	if rel, err := f.resolve(name); err == nil {
		i.evict(filepath.Join(f.path, rel))
	}
	data, _, err := i.file(f, name)
	if err == nil {
		if Revision(data) != req.Rev {
			return meta, "", &StaleError{Rev: Revision(data)}
		}
		if err = json.Unmarshal(data, &meta); err != nil {
			return meta, "", err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return meta, "", err
	}
	if req.Labels != nil {
		if err := validateStrings(*req.Labels); err != nil {
			return meta, "", err
		}
		meta.Labels = *req.Labels
	}
	if meta.Labels == nil {
		meta.Labels = []string{}
	}
	if req.Priority != nil {
		meta.Priority = *req.Priority
	}
	if req.Owner != nil {
		meta.Owner = *req.Owner
	}
	if req.Phase != nil {
		meta.Phase = *req.Phase
	}
	if req.Pinned != nil {
		meta.Pinned = *req.Pinned
	}
	data, err = json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return meta, "", err
	}
	data = append(data, '\n')
	if err = i.writeRevision(f, name, req.Rev, data); err != nil {
		return meta, "", err
	}
	return meta, Revision(data), nil
}
