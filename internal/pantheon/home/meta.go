package home

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type ProjectMeta struct {
	Autonomy       string   `json:"autonomy"`
	ApprovedStages []string `json:"approvedStages"`
	AutoMerge      bool     `json:"autoMerge"`
	MaxAttempts    int      `json:"maxAttempts"`
	AttemptMinutes int      `json:"attemptMinutes"`
	VerifyScope    string   `json:"verifyScope"`
	Resources      []string `json:"resources"`
	Labels         []string `json:"labels"`
	Priority       string   `json:"priority"`
	Owner          string   `json:"owner"`
	Phase          string   `json:"phase"`
	Pinned         bool     `json:"pinned"`
}

type PatchMeta struct {
	Autonomy       *string   `json:"autonomy"`
	ApprovedStages *[]string `json:"approvedStages"`
	AutoMerge      *bool     `json:"autoMerge"`
	MaxAttempts    *int      `json:"maxAttempts"`
	AttemptMinutes *int      `json:"attemptMinutes"`
	VerifyScope    *string   `json:"verifyScope"`
	Resources      *[]string `json:"resources"`
	Rev            string    `json:"rev"`
	Labels         *[]string `json:"labels"`
	Priority       *string   `json:"priority"`
	Owner          *string   `json:"owner"`
	Phase          *string   `json:"phase"`
	Pinned         *bool     `json:"pinned"`
}

func (i *Index) PatchMeta(cyxHome, project string, req PatchMeta) (ProjectMeta, string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	meta := DefaultMeta()
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
	if req.Autonomy != nil {
		meta.Autonomy = *req.Autonomy
	}
	if req.ApprovedStages != nil {
		meta.ApprovedStages = *req.ApprovedStages
	}
	if req.AutoMerge != nil {
		meta.AutoMerge = *req.AutoMerge
	}
	if req.MaxAttempts != nil {
		meta.MaxAttempts = *req.MaxAttempts
	}
	if req.AttemptMinutes != nil {
		meta.AttemptMinutes = *req.AttemptMinutes
	}
	if req.VerifyScope != nil {
		meta.VerifyScope = *req.VerifyScope
	}
	if err := meta.ValidateExecution(); err != nil {
		return meta, "", err
	}
	if req.Labels != nil {
		if err := validateStrings(*req.Labels); err != nil {
			return meta, "", err
		}
		meta.Labels = *req.Labels
	}
	if req.Resources != nil {
		if len(*req.Resources) > 200 {
			return meta, "", errors.New("too many resources")
		}
		for _, id := range *req.Resources {
			if !ValidResourceID(id) {
				return meta, "", errors.New("invalid resource id")
			}
		}
		meta.Resources = *req.Resources
	}
	if meta.Resources == nil {
		meta.Resources = []string{}
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

func DefaultMeta() ProjectMeta {
	return ProjectMeta{Labels: []string{}, Resources: []string{}, Autonomy: "off", ApprovedStages: []string{}, MaxAttempts: 2, AttemptMinutes: 30, VerifyScope: "auto"}
}

func (m ProjectMeta) ValidateExecution() error {
	if m.Autonomy != "off" && m.Autonomy != "stage" && m.Autonomy != "full" {
		return errors.New("autonomy must be off, stage or full")
	}
	if err := validateStrings(m.ApprovedStages); err != nil {
		return err
	}
	if m.MaxAttempts < 1 || m.MaxAttempts > 3 {
		return errors.New("maxAttempts must be between 1 and 3")
	}
	if m.AttemptMinutes < 5 || m.AttemptMinutes > 120 {
		return errors.New("attemptMinutes must be between 5 and 120")
	}
	if m.VerifyScope != "auto" && m.VerifyScope != "off" {
		return errors.New("verifyScope must be auto or off")
	}
	return nil
}
