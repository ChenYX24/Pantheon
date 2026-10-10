package home

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const resourceDirectory = "pantheon/resources"

var secretName = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,63}$`)
var resourceKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]{0,63}$`)

func ValidResourceID(value string) bool { return projectID.MatchString(value) }
func ValidSecretName(value string) bool { return secretName.MatchString(value) }

type Resource struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Title      string   `json:"title"`
	Provider   string   `json:"provider"`
	BaseURL    string   `json:"baseUrl"`
	Env        []string `json:"env"`
	SSHAlias   string   `json:"sshAlias"`
	GPUBoardID string   `json:"gpuBoardId"`
	URL        string   `json:"url"`
	Projects   []string `json:"projects"`
	Tags       []string `json:"tags"`
	Check      string   `json:"check"`
	Updated    string   `json:"updated"`
	Body       string   `json:"body"`
	Rev        string   `json:"rev"`
	File       string   `json:"file"`
}

func (r Resource) Allows(project string) bool {
	for _, id := range r.Projects {
		if id == "*" || id == project {
			return true
		}
	}
	return false
}

func ResourceSlug(title string) string {
	var b strings.Builder
	for _, c := range strings.ToLower(title) {
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-' {
			b.WriteRune(c)
		} else if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
			b.WriteByte('-')
		}
		if b.Len() >= 64 {
			break
		}
	}
	slug := strings.Trim(b.String(), "-._")
	if slug == "" {
		// Non-Latin titles still need a stable, valid filename.
		slug = "resource-" + Revision([]byte(title))
	}
	return slug
}

func parseResource(data []byte, id string) (Resource, error) {
	f, err := parseFrontmatter(data)
	if err != nil {
		return Resource{}, err
	}
	v := f.values
	r := Resource{ID: v["id"], Kind: v["kind"], Title: v["title"], Provider: v["provider"], BaseURL: v["base_url"], SSHAlias: v["ssh_alias"], GPUBoardID: v["gpu_board_id"], URL: v["url"], Check: v["check"], Updated: v["updated"], Body: string(f.body), Rev: Revision(data), File: resourceDirectory + "/" + id + ".md"}
	if !ValidResourceID(id) || r.ID != id {
		return r, errors.New("resource id must match its filename")
	}
	if strings.TrimSpace(r.Title) == "" {
		return r, errors.New("title is required")
	}
	switch r.Kind {
	case "api", "server", "dataset", "account", "service", "other":
	default:
		return r, errors.New("invalid resource kind")
	}
	switch r.Provider {
	case "", "anthropic", "openai", "openai-compatible", "feishu", "other":
	default:
		return r, errors.New("invalid resource provider")
	}
	if r.Check == "" {
		r.Check = "none"
	}
	switch r.Check {
	case "none", "provider", "http", "ssh":
	default:
		return r, errors.New("invalid resource check")
	}
	for key, target := range map[string]*[]string{"env": &r.Env, "projects": &r.Projects, "tags": &r.Tags} {
		*target, err = stringList(v[key])
		if err != nil {
			return r, fmt.Errorf("invalid %s list", key)
		}
	}
	for _, name := range r.Env {
		if !ValidSecretName(name) {
			return r, errors.New("invalid environment name")
		}
	}
	for _, project := range r.Projects {
		if project != "*" && !ValidResourceID(project) {
			return r, errors.New("invalid project id")
		}
	}
	if r.GPUBoardID == "" {
		r.GPUBoardID = r.SSHAlias
	}
	return r, nil
}

func (i *Index) resources(f *harnessFS) ([]Resource, []Warning, error) {
	out, warnings := []Resource{}, []Warning{}
	entries, err := f.entries(resourceDirectory)
	if errors.Is(err, os.ErrNotExist) {
		return out, warnings, nil
	}
	if err != nil {
		return out, warnings, err
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".md")
		if !strings.HasSuffix(entry.Name(), ".md") || !ValidResourceID(id) {
			continue
		}
		file := resourceDirectory + "/" + entry.Name()
		data, _, err := i.file(f, file)
		var resource Resource
		if err == nil {
			resource, err = parseResource(data, id)
		}
		if err != nil {
			warnings = append(warnings, Warning{File: file, Message: err.Error()})
		} else {
			out = append(out, resource)
		}
	}
	return out, warnings, nil
}

func (i *Index) Resources(cyxHome string) ([]Resource, []Warning, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	_, f, err := i.open(cyxHome)
	if err != nil {
		return nil, nil, err
	}
	defer f.root.Close()
	return i.resources(f)
}

func (i *Index) Resource(cyxHome, id string) (Resource, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !ValidResourceID(id) {
		return Resource{}, ErrNotFound
	}
	_, f, err := i.open(cyxHome)
	if err != nil {
		return Resource{}, err
	}
	defer f.root.Close()
	data, _, err := i.file(f, resourceDirectory+"/"+id+".md")
	if errors.Is(err, os.ErrNotExist) {
		err = ErrNotFound
	}
	if err != nil {
		return Resource{}, err
	}
	return parseResource(data, id)
}

// Accept frontmatter names as well as the camel-case names returned by the API.
// Unknown fields are editable too, without reserializing unrelated source bytes.
func resourceValues(fields map[string]json.RawMessage) (map[string]string, *string, error) {
	values := map[string]string{}
	var body *string
	aliases := map[string]string{"baseUrl": "base_url", "sshAlias": "ssh_alias", "gpuBoardId": "gpu_board_id"}
	for key, raw := range fields {
		if key == "rev" {
			continue
		}
		if alias, ok := aliases[key]; ok {
			key = alias
		}
		if !resourceKey.MatchString(key) {
			return nil, nil, errors.New("invalid frontmatter key")
		}
		if _, ok := values[key]; ok {
			return nil, nil, errors.New("duplicate frontmatter field")
		}
		knownList := key == "env" || key == "projects" || key == "tags"
		if knownList || strings.HasPrefix(strings.TrimSpace(string(raw)), "[") {
			if !knownList {
				switch key {
				case "id", "kind", "title", "provider", "base_url", "ssh_alias", "gpu_board_id", "url", "check", "updated", "body":
					return nil, nil, errors.New("expected a frontmatter string")
				}
			}
			var list []string
			if err := json.Unmarshal(raw, &list); err != nil || list == nil || validateStrings(list) != nil {
				return nil, nil, errors.New("expected a list of strings")
			}
			values[key] = encodeList(list)
			continue
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil || string(raw) == "null" {
			return nil, nil, errors.New("expected a frontmatter string")
		}
		if key == "body" {
			body = &value
		} else {
			values[key] = encodeScalar(value)
		}
	}
	return values, body, nil
}

func (i *Index) CreateResource(cyxHome string, fields map[string]json.RawMessage) (Resource, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	values, body, err := resourceValues(fields)
	if err != nil {
		return Resource{}, err
	}
	id := scalar(values["id"])
	if id == "" {
		id = ResourceSlug(scalar(values["title"]))
	}
	values["id"] = encodeScalar(id)
	if _, ok := values["projects"]; !ok {
		values["projects"] = `["*"]`
	}
	values["updated"] = time.Now().Format(time.RFC3339Nano)
	fm, _ := parseFrontmatter([]byte("---\n---\n"))
	if body != nil {
		fm.body = []byte(*body)
	}
	data := rewriteEncoded(fm, values)
	resource, err := parseResource(data, id)
	if err != nil {
		return Resource{}, err
	}
	_, f, err := i.open(cyxHome)
	if err != nil {
		return Resource{}, err
	}
	defer f.root.Close()
	parent, err := f.mkdirs(resourceDirectory)
	if err != nil {
		return Resource{}, err
	}
	name := filepath.Join(parent, id+".md")
	// Reserve the filename before rename, so concurrent API creators cannot
	// replace an existing resource (including a dangling symlink).
	reserved, err := f.root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if errors.Is(err, os.ErrExist) {
		return Resource{}, ErrExists
	}
	if err != nil {
		return Resource{}, err
	}
	_ = reserved.Close()
	if err = f.atomicWrite(name, data); err != nil {
		_ = f.root.Remove(name)
		return Resource{}, err
	}
	i.evict(filepath.Join(f.path, name))
	return resource, i.resourceReadme(f)
}

func (i *Index) PatchResource(cyxHome, id, rev string, fields map[string]json.RawMessage) (Resource, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	values, body, err := resourceValues(fields)
	if err != nil {
		return Resource{}, err
	}
	if !ValidResourceID(id) {
		return Resource{}, ErrNotFound
	}
	_, f, err := i.open(cyxHome)
	if err != nil {
		return Resource{}, err
	}
	defer f.root.Close()
	name, data, err := i.resourceRevision(f, id, rev)
	if err != nil {
		return Resource{}, err
	}
	fm, err := parseFrontmatter(data)
	if err != nil {
		return Resource{}, err
	}
	if body != nil {
		fm.body = []byte(*body)
	}
	values["updated"] = time.Now().Format(time.RFC3339Nano)
	data = rewriteEncoded(fm, values)
	resource, err := parseResource(data, id)
	if err != nil {
		return Resource{}, err
	}
	if err = f.atomicWrite(name, data); err != nil {
		return Resource{}, err
	}
	i.evict(filepath.Join(f.path, name))
	return resource, i.resourceReadme(f)
}

func (i *Index) resourceRevision(f *harnessFS, id, rev string) (string, []byte, error) {
	name, err := f.resolve(resourceDirectory + "/" + id + ".md")
	if errors.Is(err, os.ErrNotExist) {
		err = ErrNotFound
	}
	if err != nil {
		return "", nil, err
	}
	i.evict(filepath.Join(f.path, name))
	data, _, err := i.file(f, name)
	if err == nil && Revision(data) != rev {
		err = &StaleError{Rev: Revision(data)}
	}
	return name, data, err
}

func (i *Index) DeleteResource(cyxHome, id, rev string) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !ValidResourceID(id) {
		return ErrNotFound
	}
	_, f, err := i.open(cyxHome)
	if err != nil {
		return err
	}
	defer f.root.Close()
	name, _, err := i.resourceRevision(f, id, rev)
	if err != nil {
		return err
	}
	// Remove the directory entry, not the target of an in-Harness symlink.
	parent, err := f.resolve(resourceDirectory)
	if err != nil {
		return err
	}
	if err = f.root.Remove(filepath.Join(parent, id+".md")); err != nil {
		return err
	}
	i.evict(filepath.Join(f.path, name))
	return i.resourceReadme(f)
}

func (i *Index) resourceReadme(f *harnessFS) error {
	resources, _, err := i.resources(f)
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("# Resources\n\nUsage instructions only. Secret values are held by the panel. Low GPU usage is not authorization to allocate it.\n\n| ID | Kind | Title | Environment | Purpose |\n| --- | --- | --- | --- | --- |\n")
	cell := strings.NewReplacer("|", "\\|", "\r", " ", "\n", " ")
	sort.Slice(resources, func(a, b int) bool { return resources[a].ID < resources[b].ID })
	for _, r := range resources {
		purpose := ""
		for _, line := range strings.Split(r.Body, "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				purpose = capBytes(line, 200)
				break
			}
		}
		fmt.Fprintf(&b, "| [%s](%s.md) | %s | %s | %s | %s |\n", r.ID, r.ID, r.Kind, cell.Replace(r.Title), strings.Join(r.Env, ", "), cell.Replace(purpose))
	}
	name := resourceDirectory + "/README.md"
	// Atomic rename replaces an index symlink rather than following it.
	parent, err := f.resolve(resourceDirectory)
	if err != nil {
		return err
	}
	name = filepath.Join(parent, filepath.Base(name))
	if err = f.atomicWrite(name, []byte(b.String())); err != nil {
		return err
	}
	i.evict(filepath.Join(f.path, name))
	return nil
}
