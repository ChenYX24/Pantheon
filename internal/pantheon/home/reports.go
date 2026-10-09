package home

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var replyHeading = regexp.MustCompile(`(?m)^## 回复 · ([^\r\n]+)\r?$`)

func reportReplies(body string) []ReportReply {
	out := []ReportReply{}
	matches := replyHeading.FindAllStringSubmatchIndex(body, -1)
	for n, match := range matches {
		at := body[match[2]:match[3]]
		if _, err := time.Parse(time.RFC3339, at); err != nil {
			continue
		}
		end := len(body)
		if n+1 < len(matches) {
			end = matches[n+1][0]
		}
		out = append(out, ReportReply{At: at, Text: strings.TrimSpace(body[match[1]:end])})
	}
	return out
}

func (i *Index) ReplyReport(cyxHome, project, file, text string, rev *string) (Report, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if file == "" || file != filepath.Base(file) || strings.ContainsAny(file, "/\\") || !strings.HasSuffix(file, ".md") {
		return Report{}, ErrNotFound
	}
	if strings.TrimSpace(text) == "" || len(text) > 16000 {
		return Report{}, errors.New("a reply (1–16000 bytes) is required")
	}
	f, base, err := i.writableProject(cyxHome, project)
	if err != nil {
		return Report{}, err
	}
	defer f.root.Close()
	name := filepath.Join(base, "agent-docs", "reports", file)
	rel, err := f.resolve(name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			err = ErrNotFound
		}
		return Report{}, err
	}
	i.evict(filepath.Join(f.path, rel))
	data, at, err := i.file(f, name)
	if err != nil {
		return Report{}, err
	}
	if rev != nil && *rev != Revision(data) {
		return Report{}, &StaleError{Rev: Revision(data)}
	}
	if _, _, err = parseReport(data, file, at); err != nil {
		return Report{}, err
	}
	fm, err := parseFrontmatter(data)
	if err != nil {
		return Report{}, err
	}
	data = rewrite(fm, map[string]string{"needs_user": "false"})
	data = append(data, []byte("\n\n## 回复 · "+time.Now().Format(time.RFC3339)+"\n\n"+text+"\n")...)
	if err = f.atomicWrite(rel, data); err != nil {
		return Report{}, err
	}
	i.evict(filepath.Join(f.path, rel))
	report, _, err := parseReport(data, file, time.Now())
	return report, err
}
