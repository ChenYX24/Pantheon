// Package home indexes the Harness files. SQLite is deliberately absent: a
// fresh panel must show the same work before it has any chat or delivery rows.
package home

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"time"
)

const MaxFileSize = 256 << 10

var (
	projectID = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	taskID    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
)

var Statuses = []string{"planned", "in_progress", "awaiting_review", "awaiting_approval", "blocked", "done", "cancelled"}

func ValidStatus(value string) bool {
	for _, status := range Statuses {
		if status == value {
			return true
		}
	}
	return false
}

func Revision(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}

type Warning struct {
	ProjectID string `json:"projectId"`
	File      string `json:"file"`
	Message   string `json:"message"`
}

type Link struct {
	Title string `json:"title"`
	Href  string `json:"href"`
}

type ActiveContext struct {
	Goal         string
	ActiveDocs   []Link
	LastVerified string
	Blockers     []string
}

type Task struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Status        string   `json:"status"`
	Stage         string   `json:"stage"`
	Priority      string   `json:"priority"`
	Tags          []string `json:"tags"`
	Owner         string   `json:"owner"`
	Due           string   `json:"due"`
	Primary       string   `json:"primary"`
	Secondary     string   `json:"secondary"`
	DependsOn     []string `json:"dependsOn"`
	Session       string   `json:"session"`
	BlockedReason string   `json:"blockedReason"`
	SessionStatus string   `json:"sessionStatus"`
	Updated       string   `json:"updated"`
	Handoffs      int      `json:"handoffs"`
	Body          string   `json:"body"`
	Rev           string   `json:"rev"`
	File          string   `json:"file"`
	mtime         time.Time
}

type ReportSummary struct {
	File      string `json:"file"`
	Title     string `json:"title"`
	At        string `json:"at"`
	Kind      string `json:"kind"`
	NeedsUser bool   `json:"needsUser"`
	Summary   string `json:"summary"`
}

type Report struct {
	ReportSummary
	Task    string        `json:"task"`
	Body    string        `json:"body"`
	Rev     string        `json:"rev"`
	Replies []ReportReply `json:"replies"`

	at time.Time
}

type ReportReply struct {
	At   string `json:"at"`
	Text string `json:"text"`
}

type Stage struct {
	Name  string `json:"name"`
	Done  int    `json:"done"`
	Total int    `json:"total"`
}

type Session struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	State          string `json:"state"`
	Agent          string `json:"agent"`
	StateChangedAt string `json:"stateChangedAt"`
}

// RuntimeProject carries only the panel's live overlay, matched by directory.
type RuntimeProject struct {
	ID       string
	Path     string
	Sessions []Session
}

type Project struct {
	ID             string          `json:"id"`
	Aliases        []string        `json:"aliases"`
	Portfolio      string          `json:"portfolio"`
	Category       string          `json:"category"`
	Status         string          `json:"status"`
	StateMode      string          `json:"stateMode"`
	Sync           json.RawMessage `json:"sync"`
	Repo           string          `json:"repo,omitempty"`
	Parent         string          `json:"parent,omitempty"`
	MergedInto     string          `json:"mergedInto,omitempty"`
	Path           string          `json:"path"`
	PathExists     bool            `json:"pathExists"`
	PanelProjectID *string         `json:"panelProjectId"`
	Goal           string          `json:"goal"`
	ActiveDocs     []Link          `json:"activeDocs"`
	LastVerified   string          `json:"lastVerified"`
	Blockers       []string        `json:"blockers"`
	TaskCounts     map[string]int  `json:"taskCounts"`
	Stages         []Stage         `json:"stages"`
	LatestReport   *ReportSummary  `json:"latestReport"`
	Sessions       []Session       `json:"sessions"`
	Usage          struct {
		Known bool `json:"known"`
	} `json:"usage"`
	UpdatedAt string      `json:"updatedAt"`
	Meta      ProjectMeta `json:"meta"`
	MetaRev   string      `json:"metaRev"`
}

type TodoLink struct {
	ProjectID  string `json:"projectId"`
	TaskID     string `json:"taskId"`
	ReportFile string `json:"reportFile"`
	SessionID  string `json:"sessionId"`
}

type Todo struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	ProjectID string   `json:"projectId"`
	Title     string   `json:"title"`
	Detail    string   `json:"detail"`
	At        string   `json:"at"`
	Link      TodoLink `json:"link"`
}

type Snapshot struct {
	Available   bool              `json:"available"`
	Reason      string            `json:"reason,omitempty"`
	GeneratedAt string            `json:"generatedAt"`
	Projects    []Project         `json:"projects"`
	Todos       []Todo            `json:"todos"`
	Warnings    []Warning         `json:"warnings"`
	Details     map[string]Detail `json:"-"`
}

type Detail struct {
	Project       Project  `json:"project"`
	Tasks         []Task   `json:"tasks"`
	Reports       []Report `json:"reports"`
	Todos         []Todo   `json:"todos"`
	Directory     string   `json:"-"`
	ActiveContext string   `json:"-"`
	Memory        string   `json:"-"`
	Fields        Fields   `json:"-"`
	activeRev     string
	activeAt      string
}
