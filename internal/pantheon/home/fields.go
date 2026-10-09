package home

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type FieldOption struct {
	Value string `json:"value"`
	Label string `json:"label,omitempty"`
	Color string `json:"color"`
}

type Field struct {
	Options []FieldOption `json:"options"`
}

type Fields struct {
	Task    map[string]Field `json:"task"`
	Project map[string]Field `json:"project"`
}

func DefaultFields() Fields {
	priority := func() Field {
		return Field{[]FieldOption{{Value: "P0", Color: "red"}, {Value: "P1", Color: "orange"}, {Value: "P2", Color: "blue"}, {Value: "P3", Color: "gray"}}}
	}
	return Fields{
		Task: map[string]Field{
			"status":   {[]FieldOption{{"planned", "待规划", "gray"}, {"in_progress", "进行中", "blue"}, {"awaiting_review", "待评审", "purple"}, {"awaiting_approval", "待批准", "orange"}, {"blocked", "阻塞", "red"}, {"done", "已完成", "green"}, {"cancelled", "已取消", "gray"}}},
			"priority": priority(),
			"tags":     {[]FieldOption{{Value: "前端", Color: "blue"}, {Value: "后端", Color: "purple"}, {Value: "设计", Color: "pink"}, {Value: "研究", Color: "teal"}, {Value: "运维", Color: "orange"}}},
		},
		Project: map[string]Field{
			"labels":   {[]FieldOption{{Value: "产品", Color: "blue"}, {Value: "研究", Color: "teal"}, {Value: "基础设施", Color: "orange"}}},
			"priority": priority(),
			"phase":    {[]FieldOption{{Value: "规划", Color: "gray"}, {Value: "开发", Color: "blue"}, {Value: "验证", Color: "purple"}, {Value: "维护", Color: "green"}}},
		},
	}
}

func ValidateFields(fields Fields) error {
	colors := map[string]bool{"gray": true, "blue": true, "green": true, "orange": true, "red": true, "purple": true, "pink": true, "teal": true, "yellow": true}
	for group, definitions := range map[string]map[string]Field{"task": fields.Task, "project": fields.Project} {
		expected := []string{"status", "priority", "tags"}
		if group == "project" {
			expected = []string{"labels", "priority", "phase"}
		}
		if len(definitions) != len(expected) {
			return errors.New("fields must define task status/priority/tags and project labels/priority/phase")
		}
		for _, name := range expected {
			field, ok := definitions[name]
			if !ok || field.Options == nil || len(field.Options) > 200 {
				return fmt.Errorf("invalid %s.%s options", group, name)
			}
			seen := map[string]bool{}
			for _, option := range field.Options {
				if strings.TrimSpace(option.Value) == "" || len(option.Value) > 200 || len(option.Label) > 200 || strings.ContainsAny(option.Value+option.Label, "\r\n") || !colors[option.Color] || seen[option.Value] {
					return fmt.Errorf("invalid %s.%s option", group, name)
				}
				seen[option.Value] = true
			}
			if group == "task" && name == "status" {
				if len(seen) != len(Statuses) {
					return errors.New("status values are fixed")
				}
				for _, status := range Statuses {
					if !seen[status] {
						return errors.New("status values are fixed")
					}
				}
			}
		}
	}
	return nil
}

func (i *Index) fields(f *harnessFS) (Fields, string, error) {
	data, _, err := i.file(f, filepath.Join("pantheon", "fields.json"))
	if errors.Is(err, os.ErrNotExist) {
		return DefaultFields(), "", nil
	}
	if err != nil {
		return Fields{}, "", err
	}
	var fields Fields
	if err = json.Unmarshal(data, &fields); err != nil {
		return fields, Revision(data), err
	}
	return fields, Revision(data), ValidateFields(fields)
}

func (i *Index) Fields(cyxHome string) (Fields, string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	_, f, err := i.open(cyxHome)
	if err != nil {
		return Fields{}, "", err
	}
	defer f.root.Close()
	return i.fields(f)
}

// Compare against fresh bytes, including an absent file, before an atomic rename.
// Resolve existing links through the same root boundary as task writes.
func (i *Index) writeRevision(f *harnessFS, name, rev string, data []byte) error {
	parent, err := f.mkdirs(filepath.Dir(name))
	if err != nil {
		return err
	}
	rel := filepath.Join(parent, filepath.Base(name))
	current := ""
	if _, err := f.root.Lstat(rel); err == nil {
		rel, err = f.resolve(name)
		if err != nil {
			return err
		}
		i.evict(filepath.Join(f.path, rel))
		old, _, err := i.file(f, rel)
		if err != nil {
			return err
		}
		current = Revision(old)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if current != rev {
		return &StaleError{Rev: current}
	}
	if err := f.atomicWrite(rel, data); err != nil {
		return err
	}
	i.evict(filepath.Join(f.path, rel))
	return nil
}

func (i *Index) PutFields(cyxHome, rev string, fields Fields) (string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if err := ValidateFields(fields); err != nil {
		return "", err
	}
	_, f, err := i.open(cyxHome)
	if err != nil {
		return "", err
	}
	defer f.root.Close()
	data, err := json.MarshalIndent(fields, "", "  ")
	if err != nil {
		return "", err
	}
	data = append(data, '\n')
	if err := i.writeRevision(f, filepath.Join("pantheon", "fields.json"), rev, data); err != nil {
		return "", err
	}
	return Revision(data), nil
}

func stringList(value string) ([]string, error) {
	out := []string{}
	if value == "" {
		return out, nil
	}
	if !strings.HasPrefix(value, "[") || !strings.HasSuffix(value, "]") {
		return nil, errors.New("expected a bracketed list")
	}
	if json.Unmarshal([]byte(value), &out) == nil {
		return out, validateStrings(out)
	}
	out = []string{}
	// The original task format permits unquoted values; split only outside quotes.
	quote, escaped, start := rune(0), false, 0
	inner := value[1 : len(value)-1]
	for n, c := range inner {
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' && quote == '"' {
			escaped = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
			continue
		}
		if c == ',' {
			out = append(out, scalar(inner[start:n]))
			start = n + 1
		}
	}
	if quote != 0 {
		return nil, errors.New("unclosed list quote")
	}
	if strings.TrimSpace(inner[start:]) != "" {
		out = append(out, scalar(inner[start:]))
	}
	return out, validateStrings(out)
}

func validateStrings(values []string) error {
	if len(values) > 200 {
		return errors.New("too many values")
	}
	for _, value := range values {
		if strings.TrimSpace(value) == "" || len(value) > 200 || strings.ContainsAny(value, "\r\n") {
			return errors.New("invalid list value")
		}
	}
	return nil
}

func encodeList(values []string) string {
	if values == nil {
		return "[]"
	}
	data, _ := json.Marshal(values)
	return string(data)
}

func encodeField(key, value string) string {
	if key == "tags" || key == "depends_on" {
		return value
	}
	return encodeScalar(value)
}

func validateTaskPatch(req PatchTask) error {
	if req.Title != nil && strings.TrimSpace(*req.Title) == "" {
		return errors.New("title is required")
	}
	for _, assignment := range []*string{req.Primary, req.Secondary} {
		if assignment != nil && !validAssignment(*assignment) {
			return errors.New("executor must be <harness>/<model>")
		}
	}
	if req.Tags != nil {
		if err := validateStrings(*req.Tags); err != nil {
			return err
		}
	}
	if req.DependsOn != nil {
		for _, value := range *req.DependsOn {
			if !taskID.MatchString(value) {
				return errors.New("invalid dependency id")
			}
		}
	}
	if req.Due != nil && *req.Due != "" {
		if _, err := time.Parse("2006-01-02", *req.Due); err != nil {
			return errors.New("due must be YYYY-MM-DD")
		}
	}
	return nil
}
